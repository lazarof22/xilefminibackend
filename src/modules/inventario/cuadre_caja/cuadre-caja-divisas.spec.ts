/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { SchemaFactory } from '@nestjs/mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { deleteModel, model, Types } from 'mongoose';
import { formatearFecha } from '../../../common/utils/fecha.util';
import { FakeModel } from '../exitencia/fake-mongo-spec';
import {
  claveNueva,
  crearEntorno,
  dtoCheckout,
  efectivo,
  Entorno,
  silenciarLogs,
} from '../venta/checkout/checkout-entorno-spec';
import { ajusteDivisasCUP, flujoDeEfectivo } from './cuadre-divisas';
import { CuadreCajaService } from './cuadre_caja.service';
import { CreateCuadreCajaDto } from './dto/create-cuadre_caja.dto';
import { CuadreCaja } from './schema/cuadre_caja.schema';

/**
 * Cuadre de caja con divisas (Fase 3). Dos niveles:
 *  - las funciones puras que dicen qué entró y salió de la caja de pesos;
 *  - un día de ventas REALES (cobradas por el checkout, con sus pagos tal como
 *    quedan guardados) que se resume con el servicio de cuadre y se cuadra.
 *
 * El resumen cuenta cada venta en efectivo por su total en CUP. Una venta
 * cobrada en USD no metió ese total en la caja de pesos, y una cobrada en
 * pesos con el cambio en USD metió todo lo recibido: `ajuste_divisas` es esa
 * diferencia. Y una venta a crédito no es efectivo: no suma al esperado.
 */

describe('cuadre-divisas: lo que cada venta mueve en la caja de pesos', () => {
  it('un pago anterior a la Fase 3 (sin moneda) es en pesos y no se corrige', () => {
    const flujo = flujoDeEfectivo({ monto_pagado: 500, cambio: 60 }, 440);

    expect(flujo).toEqual({
      moneda: 'CUP',
      recibido: 500,
      monedaCambio: 'CUP',
      cambio: 60,
      conDivisas: false,
    });
    expect(ajusteDivisasCUP(flujo, 440)).toBe(0);
  });

  it('un pago sin montos (muy antiguo) se toma como cobrado justo', () => {
    const flujo = flujoDeEfectivo(undefined, 440);

    expect(flujo).toMatchObject({ moneda: 'CUP', recibido: 440, cambio: 0 });
    expect(ajusteDivisasCUP(flujo, 440)).toBe(0);
  });

  it('pesos con el formato nuevo (moneda CUP): tampoco se corrige', () => {
    const flujo = flujoDeEfectivo(
      { monto_pagado: 600, cambio: 160, moneda: 'CUP' },
      440,
    );

    expect(flujo.conDivisas).toBe(false);
    expect(ajusteDivisasCUP(flujo, 440)).toBe(0);
  });

  it('una moneda guardada como id del nomenclador (datos viejos) cuenta como pesos', () => {
    const flujo = flujoDeEfectivo(
      { monto_pagado: 500, cambio: 60, moneda: '64b0000000000000000000aa' },
      440,
    );

    expect(flujo.moneda).toBe('CUP');
    expect(ajusteDivisasCUP(flujo, 440)).toBe(0);
  });

  it('USD con el cambio en pesos: no entró nada y salió el cambio', () => {
    const flujo = flujoDeEfectivo(
      {
        monto_pagado: 2,
        cambio: 0.9,
        moneda: 'USD',
        monedaCambio: 'CUP',
        cambioConvertido: 360,
      },
      440,
    );

    expect(flujo).toEqual({
      moneda: 'USD',
      recibido: 2,
      monedaCambio: 'CUP',
      cambio: 360,
      conDivisas: true,
    });
    // La caja de pesos: 0 − 360. El resumen contó +440: corrige −800.
    expect(ajusteDivisasCUP(flujo, 440)).toBe(-800);
  });

  it('USD con el cambio en USD: la caja de pesos no se mueve', () => {
    const flujo = flujoDeEfectivo(
      { monto_pagado: 5, cambio: 3.9, moneda: 'USD', monedaCambio: 'USD' },
      440,
    );

    expect(flujo).toMatchObject({
      moneda: 'USD',
      monedaCambio: 'USD',
      cambio: 3.9,
    });
    expect(ajusteDivisasCUP(flujo, 440)).toBe(-440);
  });

  it('USD sin `monedaCambio`: el cambio también es en USD', () => {
    const flujo = flujoDeEfectivo(
      { monto_pagado: 5, cambio: 3.9, moneda: 'USD' },
      440,
    );

    expect(flujo.monedaCambio).toBe('USD');
    expect(ajusteDivisasCUP(flujo, 440)).toBe(-440);
  });

  it('pesos con el cambio en dólares: entró todo lo recibido y no salió nada', () => {
    const flujo = flujoDeEfectivo(
      {
        monto_pagado: 1000,
        cambio: 560,
        moneda: 'CUP',
        monedaCambio: 'USD',
        cambioConvertido: 1.4,
      },
      440,
    );

    expect(flujo).toMatchObject({
      moneda: 'CUP',
      recibido: 1000,
      monedaCambio: 'USD',
      cambio: 1.4,
      conDivisas: true,
    });
    expect(ajusteDivisasCUP(flujo, 440)).toBe(560);
  });
});

// ─────────────────────── Un día de ventas, resumido y cuadrado ───────────────────────

const EMPLEADO = new Types.ObjectId().toHexString();

/** Arroz 100 y Frijol 50 con stock de sobra: el día tiene más ventas que el catálogo de siempre. */
const entornoDelDia = () =>
  crearEntorno({
    impuesto: 10,
    productos: [
      { codigo: 'ARR-1', nombre: 'Arroz', precio: 100, stock: 100 },
      { codigo: 'FRI-1', nombre: 'Frijol', precio: 50, stock: 100 },
    ],
  });

function servicioDeCuadre(e: Entorno, extracciones: { monto: number }[] = []) {
  // En producción los tres tipos de pago viven en la misma colección (`pagos`).
  const pagos = new FakeModel([
    ...e.modelos.pagoEfectivo.docs,
    ...e.modelos.pagoCredito.docs,
    ...e.modelos.pagoTransferencia.docs,
  ]);
  const cuadreModel = Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      save: () => Promise.resolve(data),
    })),
    { findById: jest.fn(), findByIdAndUpdate: jest.fn() },
  );
  const usuarioModel = {
    findById: jest.fn().mockResolvedValue({ _id: EMPLEADO }),
  };
  const extraccionModel = new FakeModel(
    extracciones.map((x) => ({ fecha: new Date(), ...x })),
  );

  const servicio = new CuadreCajaService(
    cuadreModel as never,
    usuarioModel as never,
    e.modelos.ventas as never,
    pagos as never,
    extraccionModel as never,
  );

  return { servicio, cuadreModel };
}

/** El día de las ventas (la fecha en que las guardó el checkout). */
const diaDe = (e: Entorno): string =>
  formatearFecha(e.modelos.ventas.docs[0].createdAt as Date);

const lean = <T>(valor: T) => ({
  lean: () => ({ exec: () => Promise.resolve(valor) }),
});

describe('CuadreCajaService con ventas reales en pesos y divisas', () => {
  let restaurar: () => void;

  beforeEach(() => {
    restaurar = silenciarLogs();
  });
  afterEach(() => restaurar());

  /**
   * Seis ventas, todas de 440 CUP salvo las dos últimas:
   *  A  pesos, entrega 500 (cambio 60)                         → caja CUP +440
   *  B  USD: entrega 2 USD, cambio 0,90 USD pagado en CUP (360) → caja CUP −360, caja USD +2
   *  C  USD: entrega 5 USD, cambio 3,90 USD en USD               → caja USD +1,10
   *  D  pesos: entrega 1 000, cambio 1,40 USD (560 CUP)          → caja CUP +1 000, caja USD −1,40
   *  E  crédito, 110 CUP (Frijol ×2)                             → no es efectivo
   *  F  Zelle, 220 CUP (Frijol ×4)                               → transferencia
   */
  async function ventasDelDia(e: Entorno): Promise<void> {
    const cajero = e.usuario();
    const vender = (dto: ReturnType<typeof dtoCheckout>) =>
      e.checkout.ejecutar(dto, claveNueva(), cajero);
    const arroz4 = (pago: Record<string, unknown>) =>
      dtoCheckout(e, [{ i: 0, cantidad: 4 }], pago);

    await vender(arroz4(efectivo({ billete500: 1 })));
    await vender(
      arroz4({
        tipo: 'efectivo',
        moneda: 'USD',
        desgloseDenominaciones: { '1': 2 },
        monedaCambio: 'CUP',
      }),
    );
    await vender(
      arroz4({
        tipo: 'efectivo',
        moneda: 'USD',
        desgloseDenominaciones: { '5': 1 },
      }),
    );
    await vender(arroz4(efectivo({ billete1000: 1 }, { monedaCambio: 'USD' })));
    await vender(
      dtoCheckout(
        e,
        [{ i: 1, cantidad: 2 }],
        { tipo: 'credito' },
        { clienteId: String(e.modelos.clientes.docs[0]._id) },
      ),
    );
    await vender(
      dtoCheckout(e, [{ i: 1, cantidad: 4 }], {
        tipo: 'transferencia',
        canal: 'zelle',
        referenciaPago: 'Z-100',
      }),
    );
  }

  it('el resumen separa efectivo, transferencia y crédito, corrige las divisas y cuenta cada caja', async () => {
    const e = entornoDelDia();
    await ventasDelDia(e);
    const { servicio } = servicioDeCuadre(e, [{ monto: 40 }, { monto: 10 }]);

    const resumen = await servicio.getResumenDiario(diaDe(e));

    expect(resumen).toEqual({
      fecha: diaDe(e),
      cantidad_ventas: 6,
      total_ventas_dia: 2090,
      total_efectivo: 1760,
      valor_transferencias: 220,
      total_creditos: 110,
      descuentos: 0,
      total_extracciones_dia: 50,
      // CUP físicos: +440 −360 +0 +1000 = 1 080, y el resumen contó 1 760.
      ajuste_divisas: -680,
      efectivo_por_moneda: [
        { moneda: 'CUP', recibido: 1500, cambio_entregado: 420, neto: 1080 },
        { moneda: 'USD', recibido: 7, cambio_entregado: 5.3, neto: 1.7 },
      ],
    });
  });

  it('el efectivo esperado coincide con lo que hay en la caja de pesos y el cuadre sale cuadrado', async () => {
    const e = entornoDelDia();
    await ventasDelDia(e);
    const { servicio } = servicioDeCuadre(e, [{ monto: 40 }, { monto: 10 }]);
    const resumen = await servicio.getResumenDiario(diaDe(e));

    // En la caja: 1 080 de las ventas − 50 de extracciones = 1 030 pesos.
    const cuadre = (await servicio.create({
      empleado: EMPLEADO,
      creditos: resumen.total_creditos,
      total_ventas_dia: resumen.total_ventas_dia,
      total_extracciones_dia: resumen.total_extracciones_dia,
      valor_transferencias: resumen.valor_transferencias,
      ajuste_divisas: resumen.ajuste_divisas,
      recargos: 0,
      descuentos: resumen.descuentos,
      otros_motivos: [],
      desglose_billetes: { billete1000: 1, billete20: 1, billete10: 1 },
    })) as unknown as Record<string, unknown>;

    // 2 090 − 50 − 220 − 110 − 680 = 1 030.
    expect(cuadre.efectivo_esperado).toBe(1030);
    expect(cuadre.total_efectivo).toBe(1030);
    expect(cuadre.diferencia).toBe(0);
    expect(cuadre.estado).toBe('cuadrado');
    expect(cuadre.ajuste_divisas).toBe(-680);
  });

  it('sin el ajuste, las ventas en divisas harían parecer que faltan 680 pesos', async () => {
    const e = entornoDelDia();
    await ventasDelDia(e);
    const { servicio } = servicioDeCuadre(e, [{ monto: 40 }, { monto: 10 }]);
    const resumen = await servicio.getResumenDiario(diaDe(e));

    const cuadre = (await servicio.create({
      empleado: EMPLEADO,
      creditos: resumen.total_creditos,
      total_ventas_dia: resumen.total_ventas_dia,
      total_extracciones_dia: resumen.total_extracciones_dia,
      valor_transferencias: resumen.valor_transferencias,
      recargos: 0,
      descuentos: resumen.descuentos,
      otros_motivos: [],
      desglose_billetes: { billete1000: 1, billete20: 1, billete10: 1 },
    })) as unknown as Record<string, unknown>;

    expect(cuadre.efectivo_esperado).toBe(1710);
    expect(cuadre.diferencia).toBe(-680);
    expect(cuadre.estado).toBe('diferencia');
  });

  it('una venta a crédito no suma al efectivo esperado', async () => {
    const e = entornoDelDia();
    await e.checkout.ejecutar(
      dtoCheckout(
        e,
        [{ i: 1, cantidad: 2 }],
        { tipo: 'credito' },
        { clienteId: String(e.modelos.clientes.docs[0]._id) },
      ),
      claveNueva(),
      e.usuario(),
    );
    const { servicio } = servicioDeCuadre(e);

    const resumen = await servicio.getResumenDiario(diaDe(e));

    expect(resumen).toMatchObject({
      cantidad_ventas: 1,
      total_ventas_dia: 110,
      total_efectivo: 0,
      total_creditos: 110,
      valor_transferencias: 0,
      ajuste_divisas: 0,
      efectivo_por_moneda: [],
    });

    const cuadre = (await servicio.create({
      empleado: EMPLEADO,
      creditos: resumen.total_creditos,
      total_ventas_dia: resumen.total_ventas_dia,
      total_extracciones_dia: 0,
      valor_transferencias: 0,
      ajuste_divisas: resumen.ajuste_divisas,
      recargos: 0,
      descuentos: 0,
      otros_motivos: [],
      desglose_billetes: {},
    })) as unknown as Record<string, unknown>;

    // 110 de ventas − 110 a crédito: no se esperaba nada en efectivo.
    expect(cuadre.efectivo_esperado).toBe(0);
    expect(cuadre.estado).toBe('cuadrado');
  });

  it('una venta por Zelle (en dólares) cuenta como transferencia por su total en pesos, no como efectivo', async () => {
    const e = entornoDelDia();
    await e.checkout.ejecutar(
      dtoCheckout(e, [{ i: 1, cantidad: 4 }], {
        tipo: 'transferencia',
        canal: 'zelle',
        referenciaPago: 'Z-1',
      }),
      claveNueva(),
      e.usuario(),
    );
    const { servicio } = servicioDeCuadre(e);

    const resumen = await servicio.getResumenDiario(diaDe(e));

    expect(resumen).toMatchObject({
      total_ventas_dia: 220,
      total_efectivo: 0,
      valor_transferencias: 220,
      ajuste_divisas: 0,
      efectivo_por_moneda: [],
    });
  });

  it('un día solo en pesos (formato anterior) queda como en la Fase 2: sin ajuste y con una sola caja', async () => {
    const e = entornoDelDia();
    const cajero = e.usuario();
    await e.checkout.ejecutar(
      dtoCheckout(e, [{ i: 0, cantidad: 4 }], efectivo({ billete500: 1 })),
      claveNueva(),
      cajero,
    );
    await e.checkout.ejecutar(
      dtoCheckout(
        e,
        [{ i: 1, cantidad: 2 }],
        efectivo({ billete100: 1, billete50: 1 }),
      ),
      claveNueva(),
      cajero,
    );
    const { servicio } = servicioDeCuadre(e);

    const resumen = await servicio.getResumenDiario(diaDe(e));

    expect(resumen).toMatchObject({
      cantidad_ventas: 2,
      total_ventas_dia: 550,
      total_efectivo: 550,
      ajuste_divisas: 0,
    });
    expect(resumen.efectivo_por_moneda).toEqual([
      // 500 + 150 entregados; 60 + 40 de cambio.
      { moneda: 'CUP', recibido: 650, cambio_entregado: 100, neto: 550 },
    ]);
  });

  it('pagos guardados antes de la Fase 3 (sin moneda ni tasa) se resumen en pesos', async () => {
    const e = entornoDelDia();
    const pago = e.modelos.pagoEfectivo.insertar({
      monto_pagado: 1000,
      monto_pagar_CUP: 440,
      cambio: 560,
      metodoPago: 'efectivo',
      esCuentaCasa: false,
    });
    e.modelos.ventas.insertar({
      subtotal_venta: 400,
      descuento_total: 0,
      impuesto: 40,
      pago: pago._id,
      createdAt: new Date(),
    });
    const { servicio } = servicioDeCuadre(e);

    const resumen = await servicio.getResumenDiario(diaDe(e));

    expect(resumen).toMatchObject({
      total_efectivo: 440,
      ajuste_divisas: 0,
      efectivo_por_moneda: [
        { moneda: 'CUP', recibido: 1000, cambio_entregado: 560, neto: 440 },
      ],
    });
  });

  it('al actualizar un cuadre sin tocar `ajuste_divisas`, se conserva el que tenía', async () => {
    const e = entornoDelDia();
    const { servicio, cuadreModel } = servicioDeCuadre(e);
    cuadreModel.findById.mockReturnValue(
      lean({
        total_ventas_dia: 2090,
        recargos: 0,
        total_extracciones_dia: 50,
        valor_transferencias: 220,
        creditos: 110,
        ajuste_divisas: -680,
        otros_motivos: [],
        desglose_billetes: { billete1000: 1, billete20: 1, billete10: 1 },
        total_efectivo: 1030,
      }),
    );
    cuadreModel.findByIdAndUpdate.mockImplementation(
      (_id: string, data: Record<string, unknown>) => ({
        populate: () => ({ exec: () => Promise.resolve(data) }),
      }),
    );

    const igual = (await servicio.update('id', {
      recargos: 10,
    })) as unknown as Record<string, unknown>;
    const sinAjuste = (await servicio.update('id', {
      ajuste_divisas: 0,
    })) as unknown as Record<string, unknown>;

    // Con el ajuste (−680) y 10 de recargo: 1 040 esperados contra 1 030 contados.
    expect(igual.efectivo_esperado).toBe(1040);
    expect(igual.diferencia).toBe(-10);
    // Quitar el ajuste devuelve las ventas en divisas al efectivo esperado.
    expect(sinAjuste.efectivo_esperado).toBe(1710);
    expect(sinAjuste.diferencia).toBe(-680);
  });
});

describe('CreateCuadreCajaDto.ajuste_divisas', () => {
  const base = {
    empleado: EMPLEADO,
    creditos: 0,
    total_ventas_dia: 100,
    total_extracciones_dia: 0,
    desglose_billetes: {},
    valor_transferencias: 0,
    recargos: 0,
    descuentos: 0,
    otros_motivos: [],
  };

  it('es opcional y acepta valores negativos (lo normal cuando se cobra en divisas)', async () => {
    for (const ajuste of [undefined, 0, -680, 560.5]) {
      const dto = plainToInstance(CreateCuadreCajaDto, {
        ...base,
        ajuste_divisas: ajuste,
      });

      expect(await validate(dto)).toEqual([]);
    }
  });

  it('rechaza lo que no es un número', async () => {
    const dto = plainToInstance(CreateCuadreCajaDto, {
      ...base,
      ajuste_divisas: 'mucho',
    });

    const errores = await validate(dto);

    expect(errores.map((x) => x.property)).toEqual(['ajuste_divisas']);
  });
});

describe('CuadreCaja (esquema): el efectivo esperado puede ser negativo', () => {
  const NOMBRE = 'CuadreCajaEsquemaDivisas';

  // Un día con una venta de 552.20 pesos cobrada en dólares y su cambio devuelto en pesos (1448) y otra
  // de 7.98 en pesos: a la caja de pesos entraron 10 y salieron 1450.02, así que el esperado es -1440.02.
  const cuadreDelDia = (cambios: Record<string, unknown> = {}) => {
    const Modelo = model(NOMBRE, SchemaFactory.createForClass(CuadreCaja));
    return new Modelo({
      empleado: new Types.ObjectId(),
      creditos: 0,
      total_ventas_dia: 560.18,
      total_extracciones_dia: 0,
      desglose_billetes: {},
      valor_transferencias: 0,
      recargos: 0,
      ajuste_divisas: -2000.2,
      descuentos: 0,
      total_efectivo: 0,
      efectivo_esperado: -1440.02,
      diferencia: 1440.02,
      ...cambios,
    });
  };

  afterEach(() => {
    deleteModel(NOMBRE);
  });

  it('se puede guardar el cuadre de un día en que el cambio en pesos superó lo cobrado en pesos', async () => {
    await expect(cuadreDelDia().validate()).resolves.toBeUndefined();
  });

  it('lo contado en la caja sigue sin poder ser negativo', async () => {
    await expect(
      cuadreDelDia({ total_efectivo: -5 }).validate(),
    ).rejects.toMatchObject({
      errors: { total_efectivo: expect.anything() as unknown },
    });
  });
});
