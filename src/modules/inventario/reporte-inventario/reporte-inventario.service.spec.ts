import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReporteInventarioService } from './reporte-inventario.service';
import { ReservasPorProductoService } from './reservas-por-producto.service';
import { Producto } from '../producto/schemas/producto.schema';

/** Consulta encadenable: select/sort/lean devuelven la misma consulta. */
function consulta<T>(resultado: T) {
  const q: Record<string, jest.Mock> = {};
  ['select', 'sort', 'lean'].forEach((m) => {
    q[m] = jest.fn().mockReturnValue(q);
  });
  q.exec = jest.fn().mockResolvedValue(resultado);
  return q;
}

describe('ReporteInventarioService', () => {
  let service: ReporteInventarioService;
  let productoModel: { find: jest.Mock };
  let reservas: { obtenerPorProducto: jest.Mock };

  const idA = new Types.ObjectId();
  const idB = new Types.ObjectId();

  const productos = [
    {
      _id: idA,
      codigo_producto: 'A-1',
      nombre_producto: 'Televisor',
      stock_inicial: 50,
    },
    {
      _id: idB,
      codigo_producto: 'B-1',
      nombre_producto: 'Radio',
      stock_inicial: 0,
    },
  ];

  beforeEach(async () => {
    productoModel = { find: jest.fn().mockReturnValue(consulta(productos)) };
    reservas = {
      obtenerPorProducto: jest
        .fn()
        .mockResolvedValue(new Map<string, number>()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReporteInventarioService,
        { provide: getModelToken(Producto.name), useValue: productoModel },
        { provide: ReservasPorProductoService, useValue: reservas },
      ],
    }).compile();

    service = module.get(ReporteInventarioService);
  });

  it('devuelve una fila por producto con los datos que pide la tabla', async () => {
    const reporte = await service.obtenerReporte();

    expect(reporte).toEqual([
      {
        _id: idA.toString(),
        codigo_producto: 'A-1',
        nombre_producto: 'Televisor',
        productos_disponibles: 50,
        productos_reservados: 0,
        inventario_total: 50,
      },
      {
        _id: idB.toString(),
        codigo_producto: 'B-1',
        nombre_producto: 'Radio',
        productos_disponibles: 0,
        productos_reservados: 0,
        inventario_total: 0,
      },
    ]);
  });

  it('los disponibles son el stock del producto (stock_inicial)', async () => {
    const [primero] = await service.obtenerReporte();

    expect(primero.productos_disponibles).toBe(50);
  });

  it('mientras facturación no informe reservas, todos los reservados son 0', async () => {
    const reporte = await service.obtenerReporte();

    expect(reporte.map((f) => f.productos_reservados)).toEqual([0, 0]);
    expect(reporte.map((f) => f.inventario_total)).toEqual([50, 0]);
  });

  it('inventario total = disponibles − reservados cuando hay reservas', async () => {
    reservas.obtenerPorProducto.mockResolvedValue(
      new Map([[idA.toString(), 12]]),
    );

    const [a, b] = await service.obtenerReporte();

    expect(a.productos_reservados).toBe(12);
    expect(a.inventario_total).toBe(38); // 50 − 12
    expect(b.productos_reservados).toBe(0); // sin entrada en el mapa
    expect(b.inventario_total).toBe(0);
  });

  it('si hay más reservados que disponibles, el total es negativo (no se oculta)', async () => {
    reservas.obtenerPorProducto.mockResolvedValue(
      new Map([[idB.toString(), 3]]),
    );

    const [, b] = await service.obtenerReporte();

    expect(b.inventario_total).toBe(-3);
  });

  it('un stock ausente o no numérico cuenta como 0', async () => {
    productoModel.find.mockReturnValue(
      consulta([
        {
          _id: idA,
          codigo_producto: 'A-1',
          nombre_producto: 'X',
          stock_inicial: undefined,
        },
        {
          _id: idB,
          codigo_producto: 'B-1',
          nombre_producto: 'Y',
          stock_inicial: 'abc',
        },
      ]),
    );

    const reporte = await service.obtenerReporte();

    expect(reporte.map((f) => f.productos_disponibles)).toEqual([0, 0]);
    expect(reporte.map((f) => f.inventario_total)).toEqual([0, 0]);
  });

  it('sin productos devuelve una lista vacía', async () => {
    productoModel.find.mockReturnValue(consulta([]));

    await expect(service.obtenerReporte()).resolves.toEqual([]);
  });

  it('lee solo los campos necesarios y ordena por código de producto', async () => {
    const q = consulta(productos);
    productoModel.find.mockReturnValue(q);

    await service.obtenerReporte();

    expect(q.select).toHaveBeenCalledWith(
      'codigo_producto nombre_producto stock_inicial',
    );
    expect(q.sort).toHaveBeenCalledWith({ codigo_producto: 1 });
    expect(q.lean).toHaveBeenCalled();
  });

  it('no modifica nada: solo consulta', async () => {
    await service.obtenerReporte();

    expect(Object.keys(productoModel)).toEqual(['find']);
  });
});

describe('ReservasPorProductoService (pendiente de facturación)', () => {
  it('por ahora no hay reservas: devuelve un mapa vacío', async () => {
    const reservas =
      await new ReservasPorProductoService().obtenerPorProducto();

    expect(reservas.size).toBe(0);
  });
});
