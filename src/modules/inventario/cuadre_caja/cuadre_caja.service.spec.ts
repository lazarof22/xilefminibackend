import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CuadreCajaService } from './cuadre_caja.service';
import { CuadreCaja } from './schema/cuadre_caja.schema';
import { Usuario } from '../../auth/schemas/empleado.schema';
import { Venta } from '../venta/schema/venta.schema';
import { Pago } from '../pago/schema/pago.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { CreateCuadreCajaDto } from './dto/create-cuadre_caja.dto';

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

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CuadreCajaService,
        { provide: getModelToken(CuadreCaja.name), useValue: cuadreModel },
        { provide: getModelToken(Usuario.name), useValue: usuarioModel },
        { provide: getModelToken(Venta.name), useValue: ventaModel },
        { provide: getModelToken(Pago.name), useValue: pagoModel },
        {
          provide: getModelToken(Extraccion.name),
          useValue: extraccionModel,
        },
      ],
    }).compile();
    service = module.get(CuadreCajaService);
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
    });
  });
});
