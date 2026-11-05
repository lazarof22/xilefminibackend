import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReporteInventarioService } from './reporte-inventario.service';
import { ReservasPorProductoService } from './reservas-por-producto.service';
import { Producto } from '../producto/schemas/producto.schema';
import { ExistenciaService } from '../exitencia/existencia.service';
import { CLAVE_CONFIG_INVENTARIO } from '../exitencia/schema/configuracion-inventario.schema';
import { FakeModel } from '../exitencia/fake-mongo-spec';

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
  let existencias: { estaUnificado: jest.Mock; totalesPorProducto: jest.Mock };

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

    // Antes de unificar (comportamiento de siempre): el reporte lee el producto.
    existencias = {
      estaUnificado: jest.fn().mockResolvedValue(false),
      totalesPorProducto: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReporteInventarioService,
        { provide: getModelToken(Producto.name), useValue: productoModel },
        { provide: ReservasPorProductoService, useValue: reservas },
        { provide: ExistenciaService, useValue: existencias },
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

  it('antes de unificar no consulta las existencias', async () => {
    await service.obtenerReporte();

    expect(existencias.totalesPorProducto).not.toHaveBeenCalled();
  });
});

/**
 * Existencias unificadas (doc §6.1): el reporte se agrega sobre `Existencia`.
 *   disponibles = Σ disponible (cantidad − reservada)
 *   reservados  = Σ reservada
 *   inventario_total = Σ cantidad (la existencia FÍSICA, no el disponible)
 */
describe('ReporteInventarioService con existencias unificadas', () => {
  const idA = new Types.ObjectId();
  const idB = new Types.ObjectId();
  const idC = new Types.ObjectId();
  const almacen = new Types.ObjectId();
  const contenedor1 = new Types.ObjectId();
  const contenedor2 = new Types.ObjectId();

  function montar() {
    const productoModel = {
      find: jest.fn().mockReturnValue(
        consulta([
          {
            _id: idA,
            codigo_producto: 'A-1',
            nombre_producto: 'Televisor',
            stock_inicial: 999, // la caché del producto NO se usa
          },
          {
            _id: idB,
            codigo_producto: 'B-1',
            nombre_producto: 'Radio',
            stock_inicial: 999,
          },
          {
            _id: idC,
            codigo_producto: 'C-1',
            nombre_producto: 'Sin existencias',
            stock_inicial: 999,
          },
        ]),
      ),
    };
    const existenciaModel = new FakeModel([
      // Televisor: 10 en Estante 1 (8 reservadas) + 3 en Estante 2.
      {
        producto: idA,
        almacen,
        contenedor: contenedor1,
        cantidad: 10,
        reservada: 8,
        disponible: 2,
      },
      {
        producto: idA,
        almacen,
        contenedor: contenedor2,
        cantidad: 3,
        reservada: 0,
        disponible: 3,
      },
      // Radio: una fila antigua sin `disponible` ni `reservada`; id como texto.
      { producto: idB.toHexString(), almacen, contenedor: contenedor1, cantidad: 4 },
    ]);
    existenciaModel.docs[2].reservada = undefined;
    existenciaModel.docs[2].disponible = undefined;
    const config = new FakeModel([
      { clave: CLAVE_CONFIG_INVENTARIO, existenciasUnificadas: true },
    ]);
    const existenciaService = new ExistenciaService(
      existenciaModel as never,
      new FakeModel() as never,
      new FakeModel() as never,
      new FakeModel() as never,
      config as never,
    );
    const reservas = { obtenerPorProducto: jest.fn() };
    const service = new ReporteInventarioService(
      productoModel as never,
      reservas as never,
      existenciaService,
    );
    return { service, reservas, productoModel };
  }

  it('suma disponible, reservada y cantidad de las existencias de cada producto', async () => {
    const { service } = montar();

    const reporte = await service.obtenerReporte();

    expect(reporte[0]).toEqual({
      _id: idA.toString(),
      codigo_producto: 'A-1',
      nombre_producto: 'Televisor',
      productos_disponibles: 5, // 2 + 3
      productos_reservados: 8,
      inventario_total: 13, // existencia física 10 + 3
    });
  });

  it('una existencia antigua sin reservada/disponible cuenta como disponible = cantidad', async () => {
    const { service } = montar();

    const [, radio] = await service.obtenerReporte();

    expect(radio).toMatchObject({
      productos_disponibles: 4,
      productos_reservados: 0,
      inventario_total: 4,
    });
  });

  it('un producto sin existencias sale en 0 (no usa el stock del producto)', async () => {
    const { service } = montar();

    const reporte = await service.obtenerReporte();

    expect(reporte[2]).toMatchObject({
      codigo_producto: 'C-1',
      productos_disponibles: 0,
      productos_reservados: 0,
      inventario_total: 0,
    });
  });

  it('no usa el módulo de reservas anterior y mantiene las mismas columnas', async () => {
    const { service, reservas } = montar();

    const reporte = await service.obtenerReporte();

    expect(reservas.obtenerPorProducto).not.toHaveBeenCalled();
    expect(Object.keys(reporte[0]).sort()).toEqual(
      [
        '_id',
        'codigo_producto',
        'inventario_total',
        'nombre_producto',
        'productos_disponibles',
        'productos_reservados',
      ].sort(),
    );
  });
});

describe('ReservasPorProductoService (pendiente de facturación)', () => {
  it('por ahora no hay reservas: devuelve un mapa vacío', async () => {
    const reservas =
      await new ReservasPorProductoService().obtenerPorProducto();

    expect(reservas.size).toBe(0);
  });
});
