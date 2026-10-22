import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { VentaService } from './venta.service';
import { Venta } from './schema/venta.schema';
import { Cliente } from '../../clientes y provedores/cliente/schemas/cliente.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Kardex } from '../kardex/schema/kardex.schema';
import { ReportePlusService } from '../reporte_plus/reporte_plus.service';

const lean = (v: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(v) }),
});

describe('VentaService -> Reporte Plus', () => {
  const idA = new Types.ObjectId();
  const idB = new Types.ObjectId();
  let service: VentaService;
  let registrarLineas: jest.Mock;
  let pago: { metodoPago?: string; esCuentaCasa?: boolean } | null;

  beforeEach(async () => {
    pago = { metodoPago: 'transferencia' };
    registrarLineas = jest.fn().mockResolvedValue(undefined);
    const productos = new Map<string, Record<string, unknown>>([
      [
        idA.toString(),
        {
          _id: idA,
          codigo_producto: 'A1',
          nombre_producto: 'A',
          precio_venta: 100,
          stock_inicial: 10,
          stock_minimo: 1,
          save: jest.fn(),
        },
      ],
      [
        idB.toString(),
        {
          _id: idB,
          codigo_producto: 'B1',
          nombre_producto: 'B',
          precio_venta: 50,
          stock_inicial: 5,
          stock_minimo: 1,
          save: jest.fn(),
        },
      ],
    ]);
    const ventaModel = jest
      .fn()
      .mockImplementation((d) => ({
        ...d,
        _id: new Types.ObjectId(),
        save: jest.fn().mockResolvedValue({ ...d, _id: 'venta1' }),
      }));
    const mod = await Test.createTestingModule({
      providers: [
        VentaService,
        { provide: getModelToken(Venta.name), useValue: ventaModel },
        {
          provide: getModelToken(Cliente.name),
          useValue: {
            findById: jest.fn().mockResolvedValue({ nombre_cliente: 'X' }),
          },
        },
        {
          provide: getModelToken(Producto.name),
          useValue: {
            findById: jest.fn(async (id: string) => productos.get(String(id))),
          },
        },
        { provide: getModelToken(Kardex.name), useValue: {} },
        {
          provide: getModelToken('Pago'),
          useValue: { findById: jest.fn(() => lean(pago)) },
        },
        { provide: ReportePlusService, useValue: { registrarLineas } },
      ],
    }).compile();
    service = mod.get(VentaService);
  });

  const dto = () => ({
    clienteId: new Types.ObjectId().toHexString(),
    productos: [
      { productoId: idA.toString(), cantidad: 2, descuentoMonto: 20 }, // neto 180
      { productoId: idB.toString(), cantidad: 4, descuentoMonto: 0 }, // neto 200
    ],
    subtotal_venta: 400,
    descuento_total: 20,
    impuesto: 38, // 10% de 380
    pago: new Types.ObjectId().toHexString(),
  });

  it('crea una fila por producto con método de pago, stock final y el impuesto repartido', async () => {
    await service.create(dto());
    const lineas = registrarLineas.mock.calls[0][0];
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatchObject({
      codigo: 'A1',
      nombre: 'A',
      cantidadVendida: 2,
      stockFinal: 8,
      metodoPago: 'transferencia',
      descuento: 20,
      referencia: 'venta1',
    });
    expect(lineas[0].impuesto).toBeCloseTo(18);
    expect(lineas[0].total).toBeCloseTo(198);
    expect(lineas[1].total).toBeCloseTo(220);
    expect(lineas[0].total + lineas[1].total).toBeCloseTo(418);
  });

  it('cuenta casa: el total pagado es 0', async () => {
    pago = { metodoPago: 'efectivo', esCuentaCasa: true };
    await service.create(dto());
    expect(
      registrarLineas.mock.calls[0][0].map((l: { total: number }) => l.total),
    ).toEqual([0, 0]);
  });

  it('si Reporte Plus falla la venta se guarda igual', async () => {
    registrarLineas.mockRejectedValue(new Error('x'));
    await expect(service.create(dto())).resolves.toMatchObject({
      _id: 'venta1',
    });
  });
});
