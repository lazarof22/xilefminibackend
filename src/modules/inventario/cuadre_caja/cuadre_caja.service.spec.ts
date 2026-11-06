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

const lean = <T>(valor: T) => ({
  lean: () => ({ exec: () => Promise.resolve(valor) }),
});

describe('CuadreCajaService', () => {
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

  it('calcula efectivo esperado sin restar de nuevo los descuentos', async () => {
    usuarioModel.findById.mockResolvedValue({ _id: empleadoId });

    const cuadre = (await service.create(dtoBase())) as unknown as Record<
      string,
      unknown
    >;

    // 1000 - 50 - 200 - 100 + 50 = 700; contado 500 + 200 + 100 = 800
    expect(cuadre.efectivo_esperado).toBe(700);
    expect(cuadre.total_efectivo).toBe(800);
    expect(cuadre.diferencia).toBe(100);
    expect(cuadre.estado).toBe('diferencia');
  });

  it('recalcula diferencia y estado al actualizar', async () => {
    cuadreModel.findById.mockReturnValue(
      lean({ ...dtoBase(), total_efectivo: 800 }),
    );
    cuadreModel.findByIdAndUpdate.mockImplementation(
      (_id: string, data: Record<string, unknown>) => ({
        populate: () => ({ exec: () => Promise.resolve(data) }),
      }),
    );

    const actualizado = (await service.update('id', {
      recargos: 100,
    })) as unknown as Record<string, unknown>;

    expect(actualizado.efectivo_esperado).toBe(800);
    expect(actualizado.diferencia).toBe(0);
    expect(actualizado.estado).toBe('cuadrado');
  });

  it('resume el día por método de pago y suma las extracciones', async () => {
    const pagoEfectivo = new Types.ObjectId();
    const pagoTransfer = new Types.ObjectId();
    const pagoCredito = new Types.ObjectId();
    ventaModel.find.mockReturnValue(
      lean([
        {
          subtotal_venta: 500,
          descuento_total: 20,
          impuesto: 0,
          pago: pagoEfectivo,
        },
        {
          subtotal_venta: 300,
          descuento_total: 0,
          impuesto: 0,
          pago: pagoTransfer,
        },
        {
          subtotal_venta: 200,
          descuento_total: 0,
          impuesto: 0,
          pago: pagoCredito,
        },
      ]),
    );
    pagoModel.find.mockReturnValue(
      lean([
        { _id: pagoEfectivo, metodoPago: 'efectivo' },
        { _id: pagoTransfer, metodoPago: 'transferencia' },
        { _id: pagoCredito, metodoPago: 'credito' },
      ]),
    );
    extraccionModel.find.mockReturnValue(lean([{ monto: 40 }, { monto: 10 }]));

    const resumen = await service.getResumenDiario('2026-10-14');

    expect(resumen).toEqual({
      fecha: '2026-10-14',
      cantidad_ventas: 3,
      total_ventas_dia: 980,
      total_efectivo: 480,
      valor_transferencias: 300,
      total_creditos: 200,
      descuentos: 20,
      total_extracciones_dia: 50,
      moneda: 'CUP',
      turnoCajaId: null,
      fondo_inicial: 0,
      depositos_bancarios: 0,
      devoluciones_efectivo: 0,
    });
  });
  describe('turno de caja y efectivo esperado', () => {
    const turnoId = new Types.ObjectId();
    const turnoAbierto = {
      _id: turnoId,
      fechaApertura: new Date('2026-11-03T08:00:00'),
      fondoInicial: { CUP: 1000, USD: 50 },
    };

    it('sin turno abierto el cálculo es el de siempre, en CUP y sin turnoCaja', async () => {
      usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
      const c = (await service.create(dtoBase())) as unknown as Record<
        string,
        unknown
      >;
      expect(c.efectivo_esperado).toBe(700);
      expect(c.moneda).toBe('CUP');
      expect(c.turnoCaja).toBeUndefined();
      expect(c.fondo_inicial).toBe(0);
    });

    it('resta del esperado las devoluciones en efectivo registradas desde la apertura del turno, solo de la moneda del cuadre', async () => {
      usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      devolucionModel.find.mockReturnValue({
        select: () =>
          lean([
            { montoDevuelto: 150, moneda: 'CUP' },
            { montoDevuelto: 20, moneda: 'USD' },
          ]),
      });

      const c = (await service.create(dtoBase())) as unknown as Record<
        string,
        unknown
      >;

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
      usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));

      const c = (await service.create(dtoBase())) as unknown as Record<
        string,
        unknown
      >;

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

    it('usa el fondo de la moneda pedida y no mezcla monedas', async () => {
      usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      const c = (await service.create({
        ...dtoBase(),
        moneda: 'USD',
      })) as unknown as Record<string, unknown>;
      expect(c.moneda).toBe('USD');
      expect(c.fondo_inicial).toBe(50);
      expect(c.efectivo_esperado).toBe(750);
    });

    it('esperado = fondo + entradas físicas - cambio - devoluciones en efectivo - extracciones - depósitos', async () => {
      usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
      turnoModel.findOne.mockReturnValue(lean(turnoAbierto));
      depositoModel.find.mockReturnValue(
        lean([
          { monto: 200, moneda: 'CUP' },
          { monto: 99, moneda: 'USD' },
        ]),
      );
      const c = (await service.create({
        ...dtoBase(),
        otros_motivos: [],
        efectivo_recibido: 900,
        cambio_entregado: 30,
        devoluciones_efectivo: 20,
      })) as unknown as Record<string, unknown>;
      // 1000 + 900 - 30 - 20 - 50 (extracciones) - 200 (depósito CUP del turno)
      expect(c.depositos_bancarios).toBe(200);
      expect(c.efectivo_esperado).toBe(1600);
    });

    it('un crédito mayor no cambia el esperado cuando se informa el efectivo recibido', async () => {
      usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
      const base = { ...dtoBase(), otros_motivos: [], efectivo_recibido: 500 };
      const a = (await service.create(base)) as unknown as Record<
        string,
        unknown
      >;
      const b = (await service.create({
        ...base,
        creditos: 9999,
      })) as unknown as Record<string, unknown>;
      expect(b.efectivo_esperado).toBe(a.efectivo_esperado);
    });

    it('enlaza el cuadre creado en TurnoCaja.cuadre', async () => {
      usuarioModel.findById.mockResolvedValue({ _id: empleadoId });
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
  });
});
