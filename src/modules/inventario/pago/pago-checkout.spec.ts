import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  CI_CLIENTE_BASE,
  crearEntorno,
  OpcionesEntorno,
} from '../venta/checkout/checkout-entorno-spec';
import type { PagoCheckoutDto } from './dto/pago-checkout.dto';
import type { ClienteDelPago } from './pago.service';

/**
 * Validación del pago del checkout contra el total que calculó el servidor:
 * el cliente solo dice CÓMO paga; el efectivo recibido sale del desglose, el
 * cambio y la conversión de monedas los calcula el servidor.
 *
 * Usa los servicios reales sobre la base en memoria del entorno del checkout
 * (monedas, tasas, denominaciones y bancos incluidos).
 */
const pago = (datos: Record<string, unknown>): PagoCheckoutDto =>
  datos as unknown as PagoCheckoutDto;

function preparar(opciones: OpcionesEntorno = {}) {
  const entorno = crearEntorno(opciones);
  const servicio = entorno.servicios.pagos;

  return { entorno, servicio };
}

const cliente = (extra: Partial<ClienteDelPago> = {}): ClienteDelPago => ({
  _id: new Types.ObjectId(),
  tipoIdentidad: 'CI',
  id_cliente: CI_CLIENTE_BASE,
  telefono_cliente: '53456789',
  codigoPais: '+53',
  ...extra,
});

/** Error 400 con el cuerpo del checkout: mensaje y `codigo` estable. */
async function rechazo(promesa: Promise<unknown>) {
  const error = await promesa.then(
    () => undefined,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse() as {
    message: string;
    codigo?: string;
  };
}

describe('PagoService.prepararPagoCheckout', () => {
  describe('efectivo en CUP (desglose anterior)', () => {
    it('el recibido es la suma del desglose y el cambio se calcula en el servidor', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          desglose: { billete500: 1, billete100: 2, billete3: 1, billete1: 1 },
        }),
        385,
      );

      expect(r).toMatchObject({
        tipo: 'efectivo',
        montoRecibido: 704,
        cambio: 319,
        esCuentaCasa: false,
      });
      expect(r.documento).toMatchObject({
        monto_pagado: 704,
        monto_pagar_CUP: 385,
        cambio: 319,
        cliente: 'cliente-estandar',
        metodoPago: 'efectivo',
      });
      expect((r.documento.desglose as Record<string, number>).billete3).toBe(1);
    });

    it('un cobro en CUP de siempre no lleva moneda ni tasa (el documento queda como antes)', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({ tipo: 'efectivo', desglose: { billete500: 1 } }),
        385,
      );

      expect(r.moneda).toBeUndefined();
      expect(r.tasaUsada).toBeUndefined();
      expect(r.documento.moneda).toBeUndefined();
      expect(r.documento.tasaUsada).toBeUndefined();
      expect(r.documento.desgloseDenominaciones).toBeUndefined();
      expect(r.documento.monto_pagar_alCambio).toBe(0);
    });

    it('paga justo: cambio 0', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({ tipo: 'efectivo', desglose: { billete200: 1, billete20: 1 } }),
        220,
      );

      expect(r.cambio).toBe(0);
    });

    it('redondea el cambio a 2 decimales', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({ tipo: 'efectivo', desglose: { billete20: 1 } }),
        12.34,
      );

      expect(r.cambio).toBe(7.66);
    });

    it('menos que el total → 400 con las cifras', async () => {
      const { servicio } = preparar();

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'efectivo', desglose: { billete100: 3 } }),
          385,
        ),
      );

      expect(cuerpo.message).toMatch(/300\.00.*385\.00/);
      expect(cuerpo.codigo).toBe('MONTO_INSUFICIENTE');
    });

    it('sin desglose (o en cero) → 400', async () => {
      const { servicio } = preparar();

      await expect(
        servicio.prepararPagoCheckout(pago({ tipo: 'efectivo' }), 10),
      ).rejects.toThrow(BadRequestException);
      await expect(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'efectivo', desglose: { billete100: 0 } }),
          10,
        ),
      ).rejects.toThrow(/desglose de billetes es obligatorio/);
    });

    it('cliente por descuento: exige nombre, CI y teléfono', async () => {
      const { servicio } = preparar();
      const base = {
        tipo: 'efectivo',
        tipoCliente: 'cliente-por-descuento',
        desglose: { billete100: 1 },
      };

      await expect(
        servicio.prepararPagoCheckout(pago(base), 50),
      ).rejects.toThrow(/Nombre, CI y Teléfono/);
      await expect(
        servicio.prepararPagoCheckout(
          pago({
            ...base,
            datosClienteDescuento: { nombre: 'Ana', ci: '123' },
          }),
          50,
        ),
      ).rejects.toThrow(/Nombre, CI y Teléfono/);

      const r = await servicio.prepararPagoCheckout(
        pago({
          ...base,
          datosClienteDescuento: { nombre: 'Ana', ci: '123', telefono: '555' },
        }),
        50,
      );
      expect(r.documento.datosClienteDescuento).toEqual({
        nombre: 'Ana',
        ci: '123',
        telefono: '555',
      });
    });

    it('cuenta casa: no se recibe efectivo; con desglose → 400, sin él se registra el total sin cobrar', async () => {
      const { servicio } = preparar();
      const casa = { tipo: 'efectivo', tipoCliente: 'cliente-cuenta-casa' };

      await expect(
        servicio.prepararPagoCheckout(
          pago({ ...casa, desglose: { billete100: 1 } }),
          50,
        ),
      ).rejects.toThrow(/cuenta casa no se recibe efectivo/);
      await expect(
        servicio.prepararPagoCheckout(
          pago({ ...casa, desgloseDenominaciones: { '100': 1 } }),
          50,
        ),
      ).rejects.toThrow(/cuenta casa no se recibe efectivo/);

      const r = await servicio.prepararPagoCheckout(pago(casa), 50);
      expect(r).toMatchObject({
        esCuentaCasa: true,
        montoRecibido: 0,
        cambio: 0,
      });
      expect(r.documento).toMatchObject({
        monto_pagar_CUP: 50,
        esCuentaCasa: true,
        monto_pagado: 0,
      });
    });
  });

  describe('efectivo por denominaciones de la moneda (Fase 3)', () => {
    it('CUP: suma valor × cantidad, guarda las denominaciones y conserva el desglose anterior', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'CUP',
          desgloseDenominaciones: { '100': 2, '500': 1 },
        }),
        385,
      );

      expect(r).toMatchObject({
        montoRecibido: 700,
        cambio: 315,
        moneda: 'CUP',
        desgloseValidado: { '100': 2, '500': 1 },
      });
      expect(r.tasaUsada).toBeUndefined();
      expect(r.documento.moneda).toBe('CUP');
      expect(r.documento.desgloseDenominaciones).toEqual([
        { valor: 500, cantidad: 1 },
        { valor: 100, cantidad: 2 },
      ]);
      expect(r.documento.desglose).toMatchObject({
        billete500: 1,
        billete100: 2,
        billete1: 0,
      });
    });

    it('rechaza una denominación que no existe para la moneda y dice cuáles son las permitidas', async () => {
      const { servicio } = preparar();

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            moneda: 'CUP',
            desgloseDenominaciones: { '7': 1 },
          }),
          5,
        ),
      );

      expect(cuerpo.codigo).toBe('DENOMINACION_NO_PERMITIDA');
      expect(cuerpo.message).toMatch(/denominación 7 no existe para CUP/);
      expect(cuerpo.message).toMatch(/5000, 2000/);
    });

    it('cantidades no enteras, negativas o excesivas → 400', async () => {
      const { servicio } = preparar();

      for (const cantidad of [1.5, -1, 100001, '3']) {
        const cuerpo = await rechazo(
          servicio.prepararPagoCheckout(
            pago({
              tipo: 'efectivo',
              moneda: 'CUP',
              desgloseDenominaciones: { '100': cantidad },
            }),
            5,
          ),
        );
        expect(cuerpo.codigo).toBe('DESGLOSE_NO_VALIDO');
      }
    });

    it('no admite los dos desgloses a la vez', async () => {
      const { servicio } = preparar();

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            desglose: { billete100: 1 },
            desgloseDenominaciones: { '100': 1 },
          }),
          50,
        ),
      );

      expect(cuerpo.message).toMatch(/un solo desglose/);
    });

    it('una denominación desactivada deja de aceptarse', async () => {
      const { entorno, servicio } = preparar();
      for (const d of entorno.modelos.denominaciones.docs) {
        if (d.moneda === 'CUP' && d.valor === 3) d.activa = false;
      }

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            moneda: 'CUP',
            desgloseDenominaciones: { '3': 2 },
          }),
          5,
        ),
      );

      expect(cuerpo.codigo).toBe('DENOMINACION_NO_PERMITIDA');
    });
  });

  describe('efectivo en otra moneda: conversión y tasa usada (Fase 3)', () => {
    it('USD con desglose hasta 100 y cambio devuelto en CUP: cambioConvertido = cambioUSD × tasaUSD ÷ tasaCUP, con la tasa guardada', async () => {
      const { servicio } = preparar();

      // 4000 CUP a 400 CUP por USD = 10.00 USD. Paga con un billete de 100 USD.
      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'USD',
          monedaCambio: 'CUP',
          desgloseDenominaciones: { '100': 1 },
        }),
        4000,
      );

      expect(r).toMatchObject({
        tipo: 'efectivo',
        moneda: 'USD',
        montoAPagarMoneda: 10,
        montoRecibido: 100,
        cambio: 90,
        monedaCambio: 'CUP',
        cambioConvertido: 36000,
      });
      expect(r.tasaUsada).toEqual({
        tipo: 'tasaMercadoInformal',
        monedaPago: 'USD',
        tasaPago: 400,
        monedaCambio: 'CUP',
        tasaCambio: 1,
        fecha: new Date('2026-01-15T12:00:00Z'),
      });
      expect(r.documento).toMatchObject({
        moneda: 'USD',
        monto_pagado: 100,
        monto_pagar_CUP: 4000,
        monto_pagar_alCambio: 10,
        cambio: 90,
        monedaCambio: 'CUP',
        cambioConvertido: 36000,
        desgloseDenominaciones: [{ valor: 100, cantidad: 1 }],
        tasaUsada: r.tasaUsada,
      });
      // El desglose en billeteN es solo de CUP.
      expect(r.documento.desglose).toBeUndefined();
    });

    it('el cambio en la misma moneda no se convierte', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'USD',
          desgloseDenominaciones: { '20': 1 },
        }),
        4000,
      );

      expect(r).toMatchObject({
        montoAPagarMoneda: 10,
        cambio: 10,
        monedaCambio: 'USD',
      });
      expect(r.cambioConvertido).toBeUndefined();
      expect(r.tasaUsada).toMatchObject({
        monedaCambio: 'USD',
        tasaCambio: 400,
      });
    });

    it('cambio entre dos monedas extranjeras: EUR → USD', async () => {
      const { servicio } = preparar();

      // 9000 CUP a 450 = 20 EUR; paga 25 EUR → 5 EUR de cambio = 5 × 450 ÷ 400 = 5.625 → 5.63 USD.
      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'EUR',
          monedaCambio: 'USD',
          desgloseDenominaciones: { '20': 1, '5': 1 },
        }),
        9000,
      );

      expect(r).toMatchObject({
        montoAPagarMoneda: 20,
        montoRecibido: 25,
        cambio: 5,
        cambioConvertido: 5.63,
      });
      expect(r.tasaUsada).toMatchObject({
        monedaPago: 'EUR',
        tasaPago: 450,
        monedaCambio: 'USD',
        tasaCambio: 400,
      });
    });

    it('paga en CUP y recibe el cambio en USD', async () => {
      const { servicio } = preparar();

      // Total 1000 CUP; paga 2000 CUP; cambio 1000 CUP = 2.50 USD.
      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'CUP',
          monedaCambio: 'USD',
          desgloseDenominaciones: { '1000': 2 },
        }),
        1000,
      );

      expect(r).toMatchObject({
        moneda: 'CUP',
        montoAPagarMoneda: 1000,
        montoRecibido: 2000,
        cambio: 1000,
        monedaCambio: 'USD',
        cambioConvertido: 2.5,
      });
      expect(r.documento.monto_pagar_alCambio).toBe(0);
    });

    it('lo que se cobra en la moneda se redondea a 2 decimales', async () => {
      const { servicio } = preparar();

      // 1001 / 400 = 2.5025 → 2.50 USD.
      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'USD',
          desgloseDenominaciones: { '5': 1 },
        }),
        1001,
      );

      expect(r.montoAPagarMoneda).toBe(2.5);
      expect(r.cambio).toBe(2.5);
    });

    it('menos que el total en esa moneda → 400 con las cifras en USD', async () => {
      const { servicio } = preparar();

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            moneda: 'USD',
            desgloseDenominaciones: { '5': 1 },
          }),
          4000,
        ),
      );

      expect(cuerpo.codigo).toBe('MONTO_INSUFICIENTE');
      expect(cuerpo.message).toMatch(/5\.00 USD.*10\.00 USD/);
    });

    it('USD no admite billetes de más de 100 ni el desglose anterior de CUP', async () => {
      const { servicio } = preparar();

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            moneda: 'USD',
            desgloseDenominaciones: { '200': 1 },
          }),
          4000,
        ),
      );
      expect(cuerpo.codigo).toBe('DENOMINACION_NO_PERMITIDA');
      expect(cuerpo.message).toMatch(/denominación 200 no existe para USD/);

      const legado = await rechazo(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            moneda: 'USD',
            desglose: { billete100: 1 },
          }),
          4000,
        ),
      );
      expect(legado.message).toMatch(/solo sirve para CUP/);
    });

    it('usa la tasa configurada: con la del Banco Central el mismo total vale más USD', async () => {
      const { servicio } = preparar({ tipoTasa: 'tasaBancoCentral' });

      // 4000 / 120 = 33.33 USD.
      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'USD',
          desgloseDenominaciones: { '50': 1 },
        }),
        4000,
      );

      expect(r.montoAPagarMoneda).toBe(33.33);
      expect(r.cambio).toBe(16.67);
      expect(r.tasaUsada).toMatchObject({
        tipo: 'tasaBancoCentral',
        tasaPago: 120,
      });
    });

    it('toma la tasa más reciente de la moneda', async () => {
      const { entorno, servicio } = preparar();
      entorno.modelos.tasas.insertar({
        moneda: 'USD',
        tasaBancoCentral: 120,
        tasaMercadoInformal: 500,
        activa: true,
        fechaActualizacion: new Date('2026-03-01T12:00:00Z'),
      });

      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          moneda: 'USD',
          desgloseDenominaciones: { '100': 1 },
        }),
        5000,
      );

      expect(r.montoAPagarMoneda).toBe(10);
      expect(r.tasaUsada).toMatchObject({
        tasaPago: 500,
        fecha: new Date('2026-03-01T12:00:00Z'),
      });
    });

    it('sin tasa registrada, con la tasa desactivada o inválida el cobro en esa moneda se rechaza', async () => {
      const cobro = pago({
        tipo: 'efectivo',
        moneda: 'USD',
        desgloseDenominaciones: { '100': 1 },
      });

      const sinTasa = preparar({ tasas: [] });
      expect(
        (await rechazo(sinTasa.servicio.prepararPagoCheckout(cobro, 4000)))
          .codigo,
      ).toBe('TASA_NO_DISPONIBLE');

      const inactiva = preparar({
        tasas: [
          {
            moneda: 'USD',
            tasaBancoCentral: 120,
            tasaMercadoInformal: 400,
            activa: false,
          },
        ],
      });
      expect(
        (await rechazo(inactiva.servicio.prepararPagoCheckout(cobro, 4000)))
          .codigo,
      ).toBe('TASA_NO_DISPONIBLE');

      const invalida = preparar({
        tasas: [
          { moneda: 'USD', tasaBancoCentral: 120, tasaMercadoInformal: 0 },
        ],
      });
      expect(
        (await rechazo(invalida.servicio.prepararPagoCheckout(cobro, 4000)))
          .codigo,
      ).toBe('TASA_NO_VALIDA');
    });

    it('una moneda sin billetes configurados no se puede cobrar en efectivo', async () => {
      const { entorno, servicio } = preparar();
      entorno.modelos.denominaciones.docs =
        entorno.modelos.denominaciones.docs.filter((d) => d.moneda !== 'EUR');

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            moneda: 'EUR',
            desgloseDenominaciones: { '20': 1 },
          }),
          4500,
        ),
      );

      expect(cuerpo.codigo).toBe('DENOMINACION_NO_PERMITIDA');
      expect(cuerpo.message).toMatch(
        /EUR no tiene billetes ni monedas configurados/,
      );
    });

    it('una configuración de tasa inválida detiene el cobro en otras monedas, pero no el de CUP', async () => {
      const { entorno, servicio } = preparar();
      entorno.modelos.configPagos.insertar({
        clave: 'pagos',
        tipoTasa: 'tasaInventada',
      });

      await expect(
        servicio.prepararPagoCheckout(
          pago({
            tipo: 'efectivo',
            moneda: 'USD',
            desgloseDenominaciones: { '100': 1 },
          }),
          4000,
        ),
      ).rejects.toThrow(/configuración de pagos no es válida/);

      await expect(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'efectivo', desglose: { billete5000: 1 } }),
          4000,
        ),
      ).resolves.toMatchObject({ cambio: 1000 });
    });
  });

  describe('crédito', () => {
    it('exige cliente', async () => {
      const { servicio } = preparar();

      await expect(
        servicio.prepararPagoCheckout(pago({ tipo: 'credito' }), 100),
      ).rejects.toThrow(/cliente es obligatorio/);
    });

    it('con cliente guarda el total a crédito con su CI y teléfono', async () => {
      const { servicio } = preparar();
      const c = cliente();

      const r = await servicio.prepararPagoCheckout(
        pago({ tipo: 'credito' }),
        100,
        c,
      );

      expect(r).toMatchObject({ tipo: 'credito', montoRecibido: 0, cambio: 0 });
      expect(r.documento).toEqual({
        clienteId: c._id,
        monto_pagar: 100,
        tipoIdentidad: 'CI',
        ci: CI_CLIENTE_BASE,
        telefono: '53456789',
        codigoPais: '+53',
        metodoPago: 'credito',
      });
    });

    it('CI con 10 dígitos rechazada, venga en el cobro o del cliente', async () => {
      const { servicio } = preparar();

      const delCobro = await rechazo(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'credito', tipoIdentidad: 'CI', ci: '9001011234' }),
          100,
          cliente(),
        ),
      );
      expect(delCobro.codigo).toBe('CI_INVALIDA');
      expect(delCobro.message).toMatch(/exactamente 11 dígitos/);

      const delCliente = await rechazo(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'credito' }),
          100,
          cliente({ id_cliente: '9001011234' }),
        ),
      );
      expect(delCliente.codigo).toBe('CI_INVALIDA');
    });

    it('la CI no admite letras ni más de 11 dígitos', async () => {
      const { servicio } = preparar();

      for (const ci of ['9001011234A', '900101123456', '9001 011234']) {
        const cuerpo = await rechazo(
          servicio.prepararPagoCheckout(
            pago({ tipo: 'credito', ci }),
            100,
            cliente(),
          ),
        );
        expect(cuerpo.codigo).toBe('CI_INVALIDA');
      }
    });

    it('con NIT guarda el NIT (no la CI) y acepta el que mande la pantalla', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'credito',
          tipoIdentidad: 'NIT',
          nit: '01234567891',
          // Con NIT, una CI mandada de más no se toma en cuenta.
          ci: '123',
        }),
        100,
        cliente(),
      );

      expect(r.documento).toMatchObject({
        tipoIdentidad: 'NIT',
        nit: '01234567891',
      });
      expect(r.documento.ci).toBeUndefined();
    });

    it('NIT inválido (muy corto o con símbolos) → 400', async () => {
      const { servicio } = preparar();

      for (const nit of ['1234', 'AB 12345', 'NIT#12345']) {
        const cuerpo = await rechazo(
          servicio.prepararPagoCheckout(
            pago({ tipo: 'credito', tipoIdentidad: 'NIT', nit }),
            100,
            cliente(),
          ),
        );
        expect(cuerpo.codigo).toBe('NIT_INVALIDO');
      }
    });

    it('un cliente con NIT aporta su NIT sin que lo mande la pantalla', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({ tipo: 'credito' }),
        100,
        cliente({
          tipoIdentidad: 'NIT',
          id_cliente: 'EMP-12345',
          nit: 'EMP-12345',
        }),
      );

      expect(r.documento).toMatchObject({
        tipoIdentidad: 'NIT',
        nit: 'EMP-12345',
      });
    });

    it('un cliente con NIT no sirve para identificarlo por CI: su documento no es una CI', async () => {
      const { servicio } = preparar();

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'credito', tipoIdentidad: 'CI' }),
          100,
          cliente({
            tipoIdentidad: 'NIT',
            id_cliente: 'EMP-12345',
            nit: 'EMP-12345',
          }),
        ),
      );

      expect(cuerpo.codigo).toBe('IDENTIDAD_REQUERIDA');
    });

    it('sin ninguna identidad → 400', async () => {
      const { servicio } = preparar();

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'credito' }),
          100,
          cliente({ id_cliente: undefined }),
        ),
      );

      expect(cuerpo.codigo).toBe('IDENTIDAD_REQUERIDA');
    });

    it('guarda el prefijo de país elegido y valida el teléfono que escribe el cajero', async () => {
      const { servicio } = preparar();

      const r = await servicio.prepararPagoCheckout(
        pago({ tipo: 'credito', telefono: '305 555 0100', codigoPais: '+1' }),
        100,
        cliente(),
      );
      expect(r.documento).toMatchObject({
        telefono: '305 555 0100',
        codigoPais: '+1',
      });

      const cuerpo = await rechazo(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'credito', telefono: '12' }),
          100,
          cliente(),
        ),
      );
      expect(cuerpo.codigo).toBe('TELEFONO_INVALIDO');
    });

    it('sin prefijo en el cobro ni en el cliente es +53; el prefijo del cliente se respeta', async () => {
      const { servicio } = preparar();

      const porDefecto = await servicio.prepararPagoCheckout(
        pago({ tipo: 'credito' }),
        100,
        cliente({ codigoPais: undefined }),
      );
      expect(porDefecto.documento.codigoPais).toBe('+53');

      const delCliente = await servicio.prepararPagoCheckout(
        pago({ tipo: 'credito' }),
        100,
        cliente({ codigoPais: '+34' }),
      );
      expect(delCliente.documento.codigoPais).toBe('+34');
    });
  });

  describe('transferencia', () => {
    it('exige referencia y banco', async () => {
      const { servicio } = preparar();

      await expect(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'transferencia', banco: 'BPA' }),
          100,
        ),
      ).rejects.toThrow(/referencia/);
      await expect(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'transferencia', numeroCuenta: '123' }),
          100,
        ),
      ).rejects.toThrow(/banco/);
    });

    it('acepta la referencia como número de cuenta o como referencia de pago', async () => {
      const { servicio } = preparar();

      const a = await servicio.prepararPagoCheckout(
        pago({ tipo: 'transferencia', numeroCuenta: 'ACC-1', banco: 'BPA' }),
        100,
      );
      const b = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'transferencia',
          referenciaPago: 'REF-9',
          banco: 'BANDEC',
        }),
        100,
      );

      expect(a.documento).toMatchObject({
        montoPagar: 100,
        numeroCuenta: 'ACC-1',
        referenciaPago: 'ACC-1',
        banco: 'BPA',
        canal: 'banco',
      });
      expect(b.documento).toMatchObject({
        montoPagar: 100,
        numeroCuenta: 'REF-9',
        referenciaPago: 'REF-9',
        banco: 'BANDEC',
      });
      // Una transferencia en CUP de siempre no lleva moneda ni tasa.
      expect(a.moneda).toBeUndefined();
      expect(a.documento.moneda).toBeUndefined();
      expect(a.documento.tasaUsada).toBeUndefined();
    });

    it('con el banco del nomenclador guarda su código y su id; un banco inexistente o desactivado se rechaza', async () => {
      const { entorno, servicio } = preparar();
      const [bpa, , , bicsa] = entorno.modelos.bancos.docs;
      bicsa.activo = false;

      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'transferencia',
          numeroCuenta: '9225123412341234',
          bancoId: String(bpa._id),
          tipoCuenta: 'tarjeta',
        }),
        100,
      );
      expect(r.documento).toMatchObject({
        banco: 'BPA',
        bancoId: bpa._id as Types.ObjectId,
        tipoCuenta: 'tarjeta',
      });

      for (const bancoId of [String(bicsa._id), String(new Types.ObjectId())]) {
        const cuerpo = await rechazo(
          servicio.prepararPagoCheckout(
            pago({ tipo: 'transferencia', numeroCuenta: '1', bancoId }),
            100,
          ),
        );
        expect(cuerpo.codigo).toBe('BANCO_NO_VALIDO');
      }
    });

    describe('prefijo de la tarjeta (aviso que no bloquea)', () => {
      const bancos = [
        {
          codigo: 'BPA',
          nombre: 'Banco Popular de Ahorro',
          prefijosTarjeta: ['????0699'],
        },
        {
          codigo: 'BM',
          nombre: 'Banco Metropolitano',
          prefijosTarjeta: ['9227', '????0598'],
        },
        { codigo: 'BANDEC', nombre: 'Banco de Crédito y Comercio' },
      ];

      const cobrar = async (
        numero: string,
        banco: 'BPA' | 'BM' | 'BANDEC',
        tipoCuenta: 'tarjeta' | 'cuenta' = 'tarjeta',
      ) => {
        const { entorno, servicio } = preparar({ bancos });
        const doc = entorno.modelos.bancos.docs.find(
          (b) => b.codigo === banco,
        )!;

        return servicio.prepararPagoCheckout(
          pago({
            tipo: 'transferencia',
            numeroCuenta: numero,
            bancoId: String(doc._id),
            tipoCuenta,
          }),
          100,
        );
      };

      it('el prefijo coincide: sin aviso (con espacios o guiones en el número)', async () => {
        expect(
          (await cobrar('9225 0699 1234 5678', 'BPA')).advertencias,
        ).toBeUndefined();
        expect(
          (await cobrar('9225-0699-1234-5678', 'BPA')).advertencias,
        ).toBeUndefined();
        expect(
          (await cobrar('9227 1111 2222 3333', 'BM')).advertencias,
        ).toBeUndefined();
      });

      it('el número tiene el prefijo de OTRO banco: aviso, no bloqueo (el pago se prepara igual)', async () => {
        const r = await cobrar('9225 0598 1234 5678', 'BPA');

        expect(r.advertencias).toHaveLength(1);
        expect(r.advertencias![0]).toMatch(
          /parece de Banco Metropolitano \(BM\)/,
        );
        expect(r.advertencias![0]).toMatch(/no bloquea el cobro/);
        expect(r.tipo).toBe('transferencia');
        expect(r.documento.banco).toBe('BPA');
      });

      it('no coincide con ningún banco conocido: aviso genérico', async () => {
        const r = await cobrar('9225 7777 1234 5678', 'BPA');

        expect(r.advertencias![0]).toMatch(
          /no empieza con ninguno de los prefijos configurados para Banco Popular de Ahorro/,
        );
      });

      it('un banco sin prefijos configurados no valida nada', async () => {
        expect(
          (await cobrar('1234 5678 9012 3456', 'BANDEC')).advertencias,
        ).toBeUndefined();
      });

      it('solo se valida si el número es de una tarjeta', async () => {
        expect(
          (await cobrar('0001-ABC', 'BPA', 'cuenta')).advertencias,
        ).toBeUndefined();
      });
    });

    it('Zelle es un canal en USD: no pide banco, guarda el monto en dólares y la tasa', async () => {
      const { servicio } = preparar();

      // 4000 CUP a 400 = 10 USD por Zelle.
      const r = await servicio.prepararPagoCheckout(
        pago({
          tipo: 'transferencia',
          canal: 'zelle',
          referenciaPago: 'ZL-7788',
        }),
        4000,
      );

      expect(r).toMatchObject({
        tipo: 'transferencia',
        moneda: 'USD',
        montoAPagarMoneda: 10,
        tasaUsada: {
          tipo: 'tasaMercadoInformal',
          monedaPago: 'USD',
          tasaPago: 400,
        },
      });
      expect(r.documento).toMatchObject({
        canal: 'zelle',
        montoPagar: 4000,
        moneda: 'USD',
        montoMoneda: 10,
        numeroCuenta: 'ZL-7788',
        banco: undefined,
        bancoId: undefined,
      });
    });

    it('EnZona y Transfermóvil son canales en CUP y no piden banco', async () => {
      const { servicio } = preparar();

      for (const canal of ['enzona', 'transfermovil']) {
        const r = await servicio.prepararPagoCheckout(
          pago({ tipo: 'transferencia', canal, numeroCuenta: 'TX-1' }),
          250,
        );

        expect(r.documento).toMatchObject({ canal, montoPagar: 250 });
        expect(r.tasaUsada).toBeUndefined();
      }
    });

    it('el canal banco sigue exigiendo banco', async () => {
      const { servicio } = preparar();

      await expect(
        servicio.prepararPagoCheckout(
          pago({ tipo: 'transferencia', canal: 'banco', numeroCuenta: '1' }),
          100,
        ),
      ).rejects.toThrow(/banco de la transferencia es obligatorio/);
    });
  });

  it('un tipo de pago desconocido → 400', async () => {
    const { servicio } = preparar();

    await expect(
      servicio.prepararPagoCheckout(pago({ tipo: 'cripto' }), 100),
    ).rejects.toThrow(/Tipo de pago no válido/);
  });

  describe('monedasDeCobro (lo que ve el punto de venta)', () => {
    it('CUP, USD y EUR con su tasa y sus billetes, del mayor al menor', async () => {
      const { servicio } = preparar();

      const { tipoTasa, monedas } = await servicio.monedasDeCobro();

      expect(tipoTasa).toBe('tasaMercadoInformal');
      expect(monedas.map((m) => m.codigo)).toEqual(['CUP', 'USD', 'EUR']);
      expect(monedas[0]).toMatchObject({
        codigo: 'CUP',
        nombre: 'Peso cubano',
        cupPorUnidad: 1,
        denominaciones: [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 3, 1],
      });
      expect(monedas[1]).toMatchObject({
        codigo: 'USD',
        nombre: 'Dólar estadounidense',
        cupPorUnidad: 400,
        denominaciones: [100, 50, 20, 10, 5, 1],
      });
      expect(monedas[2].cupPorUnidad).toBe(450);
    });

    it('una moneda sin tasa o sin billetes no aparece; con la tasa del Banco Central cambia la tasa', async () => {
      const sinEuro = preparar({
        tasas: [
          { moneda: 'USD', tasaBancoCentral: 120, tasaMercadoInformal: 400 },
        ],
        tipoTasa: 'tasaBancoCentral',
      });

      const { tipoTasa, monedas } = await sinEuro.servicio.monedasDeCobro();

      expect(tipoTasa).toBe('tasaBancoCentral');
      expect(monedas.map((m) => m.codigo)).toEqual(['CUP', 'USD']);
      expect(monedas[1].cupPorUnidad).toBe(120);
    });
  });
});
