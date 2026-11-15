import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CuadreCajaService } from './cuadre_caja.service';
import { CuadreCaja } from './schema/cuadre_caja.schema';
import { Usuarios } from '../../auth/schemas/usuarios.schema';
import { Venta } from '../venta/schema/venta.schema';
import { Pago } from '../pago/schema/pago.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { CreateCuadreCajaDto } from './dto/create-cuadre_caja.dto';
import { TurnoCaja } from '../turno-caja/schema/turno-caja.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import { Devolucion } from '../devolucion/schema/devolucion.schema';

/**
 * Cuadre de caja con el turno abierto del cajero (Fase 4/5) y su combinación
 * con los pagos en divisas (Fase 3): fondo inicial, depósitos bancarios y
 * devoluciones en efectivo de la moneda del cuadre.
 */

const lean = <T>(valor: T) => ({
  lean: () => ({ exec: () => Promise.resolve(valor) }),
});

describe('CuadreCajaService con turno de caja', () => {
  let service: CuadreCajaService;
  const empleadoId = new Types.ObjectId().toHexString();

  const cuadreModel = Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      save: () => Promise.resolve(data),
    })),
    {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    },
  );
  const usuarioModel = { findById: jest.fn() };
  const ventaModel = { find: jest.fn() };
  const pagoModel = { find: jest.fn() };
  const extraccionModel = { find: jest.fn() };
  const turnoModel = { findOne: jest.fn(), updateOne: jest.fn() };
  const depositoModel = { find: jest.fn() };
  const devolucionModel = { find: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CuadreCajaService,
        { provide: getModelToken(CuadreCaja.name), useValue: cuadreModel },
        { provide: getModelToken(Usuarios.name), useValue: usuarioModel },
        { provide: getModelToken(Venta.name), useValue: ventaModel },
        { provide: getModelToken(Pago.name), useValue: pagoModel },
        {
          provide: getModelToken(Extraccion.name),
          useValue: extraccionModel,
        },
        { provide: getModelToken(TurnoCaja.name), useValue: turnoModel },
        {
          provide: getModelToken(DepositoBancario.name),
          useValue: depositoModel,
        },
        { provide: getModelToken(Devolucion.name), useValue: devolucionModel },
      ],
    }).compile();
    service = module.get(CuadreCajaService);
    // por defecto: el cajero no tiene turno abierto y no hay depósitos
    turnoModel.findOne.mockReturnValue(lean(null));
    turnoModel.updateOne.mockResolvedValue({});
    depositoModel.find.mockReturnValue(lean([]));
    devolucionModel.find.mockReturnValue({ select: () => lean([]) });
    usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
  });

  const dtoBase = (): CreateCuadreCajaDto => ({
    empleado: empleadoId,
    creditos: 100,
    total_ventas_dia: 1000,
    total_extracciones_dia: 50,
    desglose_billetes: { billete500: 1, billete200: 1, billete100: 1 },
    valor_transferencias: 200,
    recargos: 0,
    descuentos: 30,
    otros_motivos: [{ concepto: 'Fondo', monto: 50, tipo: 'ingreso' }],
  });

  const crear = async (dto: CreateCuadreCajaDto) =>
    (await service.create(dto)) as unknown as Record<string, unknown>;

  describe('turno de caja y efectivo esperado', () => {
    const turnoId = new Types.ObjectId();
    const turnoAbierto = {
      _id: turnoId,
      fechaApertura: new Date('2026-11-03T08:00:00'),
      fondoInicial: { CUP: 1000, USD: 50 },
    };

    it('sin turno abierto el cálculo es el de siempre, en CUP y sin turnoCaja', async () => {
      const c = await crear(dtoBase());
      expect(c.efectivo_esperado).toBe(700);
      expect(c.moneda).toBe('CUP');
      expect(c.turnoCaja).toBeUndefined();
      expect(c.fondo_inicial).toBe(0);
    });

    it('resta del esperado las devoluciones en efectivo registradas desde la apertura del turno, solo de la moneda del cuadre', async () => {
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      devolucionModel.find.mockReturnValue({
        select: () =>
          lean([
            { montoDevuelto: 150, moneda: 'CUP' },
            { montoDevuelto: 20, moneda: 'USD' },
          ]),
      });

      const c = await crear(dtoBase());

      expect(devolucionModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          formaDevolucionDinero: 'efectivo',
          estado: 'registrada',
          $or: [
            { turnoCaja: turnoAbierto._id },
            {
              turnoCaja: { $exists: false },
              fecha: expect.objectContaining({
                $gte: turnoAbierto.fechaApertura,
              }),
            },
          ],
        }),
      );
      expect(c.devoluciones_efectivo).toBe(150);
      // 700 de siempre + 1000 de fondo - 150 devueltos en efectivo
      expect(c.efectivo_esperado).toBe(1550);
    });

    it('vincula el turno abierto del cajero y suma el fondo inicial de la moneda', async () => {
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));

      const c = await crear(dtoBase());

      expect(turnoModel.findOne).toHaveBeenCalledWith({
        cajeroId: new Types.ObjectId(empleadoId),
        estado: 'abierto',
      });
      expect(c.turnoCaja).toEqual(turnoId);
      expect(c.fondo_inicial).toBe(1000);
      // 700 de siempre + 1000 de fondo
      expect(c.efectivo_esperado).toBe(1700);
      expect(c.diferencia).toBe(800 - 1700);
    });

    it('usa el fondo de la moneda pedida y no le atribuye los totales de venta en CUP', async () => {
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      // ADAPTADO: antes (solo Fase 4/5) los totales de venta del DTO se tomaban
      // como cifras de la moneda del cuadre (esperado 750). Con pagos en
      // divisas esos totales son siempre CUP y no se atribuyen a USD: lo
      // recibido y el cambio de la caja USD se informan aparte.
      const c = await crear({
        ...dtoBase(),
        moneda: 'USD',
        efectivo_recibido: 80,
        cambio_entregado: 5,
      });
      expect(c.moneda).toBe('USD');
      expect(c.fondo_inicial).toBe(50);
      // 50 de fondo + 80 recibidos - 5 de cambio - 50 de extracciones + 50 de otros
      expect(c.efectivo_esperado).toBe(125);
    });

    it('en otra moneda, sin efectivo recibido informado, no se derivan los totales de venta en CUP', async () => {
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      const c = await crear({
        ...dtoBase(),
        moneda: 'USD',
        otros_motivos: [],
        total_extracciones_dia: 0,
      });
      expect(c.efectivo_esperado).toBe(50);
    });

    it('esperado = fondo + entradas físicas - cambio - devoluciones en efectivo - extracciones - depósitos', async () => {
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      depositoModel.find.mockReturnValue(
        lean([
          { monto: 200, moneda: 'CUP' },
          { monto: 99, moneda: 'USD' },
        ]),
      );
      const c = await crear({
        ...dtoBase(),
        otros_motivos: [],
        efectivo_recibido: 900,
        cambio_entregado: 30,
        devoluciones_efectivo: 20,
      });
      // 1000 + 900 - 30 - 20 - 50 (extracciones) - 200 (depósito CUP del turno)
      expect(c.depositos_bancarios).toBe(200);
      expect(c.efectivo_esperado).toBe(1600);
    });

    it('un crédito mayor no cambia el esperado cuando se informa el efectivo recibido', async () => {
      const base = { ...dtoBase(), otros_motivos: [], efectivo_recibido: 500 };
      const a = await crear(base);
      const b = await crear({ ...base, creditos: 9999 });
      expect(b.efectivo_esperado).toBe(a.efectivo_esperado);
    });

    it('enlaza el cuadre creado en TurnoCaja.cuadre', async () => {
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      cuadreModel.mockImplementationOnce((data: Record<string, unknown>) => ({
        ...data,
        save: () => Promise.resolve({ ...data, _id: 'cuadre-1' }),
      }));
      await service.create(dtoBase());
      expect(turnoModel.updateOne).toHaveBeenCalledWith(
        { _id: turnoId },
        { $set: { cuadre: 'cuadre-1' } },
      );
    });

    it('al actualizar conserva el fondo del turno y recalcula', async () => {
      cuadreModel.findById.mockReturnValue(
        lean({
          ...dtoBase(),
          total_efectivo: 800,
          fondo_inicial: 1000,
          moneda: 'CUP',
        }),
      );
      cuadreModel.findByIdAndUpdate.mockImplementation(
        (_id: string, data: Record<string, unknown>) => ({
          populate: () => ({ exec: () => Promise.resolve(data) }),
        }),
      );
      const r = (await service.update('id', {
        recargos: 100,
      })) as unknown as Record<string, unknown>;
      expect(r.efectivo_esperado).toBe(1800);
    });
  });

  describe('resumen diario con turno', () => {
    it('informa moneda, turno, fondo inicial y depósitos del cajero', async () => {
      const turnoId = new Types.ObjectId();
      ventaModel.find.mockReturnValue(lean([]));
      extraccionModel.find.mockReturnValue(lean([]));
      turnoModel.findOne.mockReturnValue(
        lean({ _id: turnoId, fondoInicial: { CUP: 1000 } }),
      );
      depositoModel.find.mockReturnValue(lean([{ monto: 300, moneda: 'CUP' }]));

      const r = await service.getResumenDiario('2026-10-14', empleadoId);

      expect(r).toMatchObject({
        moneda: 'CUP',
        turnoCajaId: turnoId.toHexString(),
        fondo_inicial: 1000,
        depositos_bancarios: 300,
        devoluciones_efectivo: 0,
      });
    });

    it('sin empleado ni moneda el resumen conserva su forma de siempre (sin datos de turno)', async () => {
      ventaModel.find.mockReturnValue(lean([]));
      extraccionModel.find.mockReturnValue(lean([]));

      const r = await service.getResumenDiario('2026-10-14');

      expect(r).not.toHaveProperty('moneda');
      expect(r).not.toHaveProperty('turnoCajaId');
      expect(turnoModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('turno abierto combinado con pagos en divisas', () => {
    const turnoId = new Types.ObjectId();
    const turno = {
      _id: turnoId,
      fechaApertura: new Date('2026-11-03T08:00:00'),
      fondoInicial: { CUP: 1000, USD: 50 },
    };
    const pagoCUP = new Types.ObjectId();
    const pagoUsdCambioCUP = new Types.ObjectId();
    const pagoUsdCambioUSD = new Types.ObjectId();

    /**
     *  A  500 CUP, entrega 500 en pesos                          → caja CUP +500
     *  B  440 CUP, entrega 2 USD, cambio 360 CUP                  → caja CUP −360, caja USD +2
     *  C  440 CUP, entrega 5 USD, cambio 3,90 USD                 → caja USD +1,10
     */
    const diaConDivisas = () => {
      const venta = (pago: Types.ObjectId, subtotal: number) => ({
        subtotal_venta: subtotal,
        descuento_total: 0,
        impuesto: 0,
        pago,
      });
      ventaModel.find.mockReturnValue(
        lean([
          venta(pagoCUP, 500),
          venta(pagoUsdCambioCUP, 440),
          venta(pagoUsdCambioUSD, 440),
        ]),
      );
      pagoModel.find.mockReturnValue(
        lean([
          {
            _id: pagoCUP,
            metodoPago: 'efectivo',
            moneda: 'CUP',
            monto_pagado: 500,
            cambio: 0,
          },
          {
            _id: pagoUsdCambioCUP,
            metodoPago: 'efectivo',
            moneda: 'USD',
            monto_pagado: 2,
            cambio: 0.9,
            monedaCambio: 'CUP',
            cambioConvertido: 360,
          },
          {
            _id: pagoUsdCambioUSD,
            metodoPago: 'efectivo',
            moneda: 'USD',
            monto_pagado: 5,
            cambio: 3.9,
            monedaCambio: 'USD',
          },
        ]),
      );
      extraccionModel.find.mockReturnValue(
        lean([
          { monto: 40, moneda: 'CUP' },
          { monto: 5, moneda: 'USD' },
        ]),
      );
      turnoModel.findOne.mockReturnValue(lean(turno));
      depositoModel.find.mockReturnValue(
        lean([
          { monto: 300, moneda: 'CUP' },
          { monto: 10, moneda: 'USD' },
        ]),
      );
      devolucionModel.find.mockReturnValue({
        select: () =>
          lean([
            { montoDevuelto: 100, moneda: 'CUP' },
            { montoDevuelto: 20, moneda: 'USD' },
          ]),
      });
    };

    it('(a) CUP: las ventas cobradas en USD no cuentan como pesos recibidos y el turno se aplica encima', async () => {
      diaConDivisas();

      const resumen = await service.getResumenDiario(
        '2026-11-03',
        empleadoId,
        'CUP',
      );

      expect(resumen).toMatchObject({
        moneda: 'CUP',
        turnoCajaId: turnoId.toHexString(),
        cantidad_ventas: 3,
        total_ventas_dia: 1380,
        total_extracciones_dia: 40,
        // Pesos que de verdad entraron: 500 − 360 = 140; el resumen contó 1 380.
        ajuste_divisas: -1240,
        fondo_inicial: 1000,
        depositos_bancarios: 300,
        devoluciones_efectivo: 100,
      });
      expect(resumen.efectivo_por_moneda).toEqual([
        { moneda: 'CUP', recibido: 500, cambio_entregado: 360, neto: 140 },
        { moneda: 'USD', recibido: 7, cambio_entregado: 3.9, neto: 3.1 },
      ]);

      const c = await crear({
        empleado: empleadoId,
        creditos: resumen.total_creditos,
        total_ventas_dia: resumen.total_ventas_dia,
        total_extracciones_dia: resumen.total_extracciones_dia,
        valor_transferencias: resumen.valor_transferencias,
        ajuste_divisas: resumen.ajuste_divisas,
        recargos: 0,
        descuentos: resumen.descuentos,
        otros_motivos: [],
        desglose_billetes: { billete500: 1, billete200: 1 },
      });

      // 1000 de fondo + 140 de pesos netos − 100 devueltos − 40 extraídos − 300 depositados
      expect(c.depositos_bancarios).toBe(300);
      expect(c.devoluciones_efectivo).toBe(100);
      expect(c.efectivo_esperado).toBe(700);
      expect(c.total_efectivo).toBe(700);
      expect(c.estado).toBe('cuadrado');
      expect(c.turnoCaja).toEqual(turnoId);
    });

    it('(b) USD: esperado = fondo USD + USD recibidos − cambio en USD − devoluciones, extracciones y depósitos en USD', async () => {
      diaConDivisas();

      const resumen = await service.getResumenDiario(
        '2026-11-03',
        empleadoId,
        'USD',
      );

      // Los totales en CUP no se atribuyen al USD; la caja USD sí se informa.
      expect(resumen).toMatchObject({
        moneda: 'USD',
        cantidad_ventas: 2,
        total_ventas_dia: 0,
        total_efectivo: 0,
        valor_transferencias: 0,
        total_creditos: 0,
        ajuste_divisas: 0,
        total_extracciones_dia: 5,
        fondo_inicial: 50,
        depositos_bancarios: 10,
        devoluciones_efectivo: 20,
      });
      const caja = resumen.efectivo_por_moneda.find((m) => m.moneda === 'USD');
      expect(caja).toEqual({
        moneda: 'USD',
        recibido: 7,
        cambio_entregado: 3.9,
        neto: 3.1,
      });

      const c = await crear({
        empleado: empleadoId,
        moneda: 'USD',
        creditos: 0,
        total_ventas_dia: resumen.total_ventas_dia,
        total_extracciones_dia: resumen.total_extracciones_dia,
        valor_transferencias: 0,
        recargos: 0,
        descuentos: 0,
        otros_motivos: [],
        efectivo_recibido: caja?.recibido,
        cambio_entregado: caja?.cambio_entregado,
        desglose_billetes: {},
        total_efectivo: 18.1,
      });

      // 50 + 7 − 3,90 − 20 − 5 − 10 = 18,10
      expect(c.moneda).toBe('USD');
      expect(c.fondo_inicial).toBe(50);
      expect(c.depositos_bancarios).toBe(10);
      expect(c.devoluciones_efectivo).toBe(20);
      expect(c.efectivo_esperado).toBe(18.1);
      expect(c.estado).toBe('cuadrado');
    });
  });
});
