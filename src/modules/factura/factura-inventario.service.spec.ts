import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  FacturaInventarioService,
  FacturaParaInventario,
  agregarCantidadesPorProducto,
} from './factura-inventario.service';
import {
  Producto,
  ProductoDocument,
} from '../inventario/producto/schemas/producto.schema';
import { Kardex, KardexTipo } from '../inventario/kardex/schema/kardex.schema';
import {
  Estado,
  EstadoDocument,
} from '../nomencladores/estado/schema/estado.schema';

const ALMACEN_ID = '507f1f77bcf86cd799439011';
const PRODUCTO_A = '507f1f77bcf86cd7994390aa';
const PRODUCTO_B = '507f1f77bcf86cd7994390bb';
const ESTADO_INACTIVO_ID = '507f1f77bcf86cd7994390ee';

interface QueryMock<T> {
  exec: jest.Mock<Promise<T>, []>;
}

function crearQueryMock<T>(resultado: T): QueryMock<T> {
  return { exec: jest.fn<Promise<T>, []>().mockResolvedValue(resultado) };
}

function crearQueryFallida<T>(error: Error): QueryMock<T> {
  return { exec: jest.fn<Promise<T>, []>().mockRejectedValue(error) };
}

type ProductoModelMock = {
  findOneAndUpdate: jest.Mock<QueryMock<ProductoDocument | null>, unknown[]>;
  updateOne: jest.Mock<QueryMock<{ matchedCount: number }>, unknown[]>;
  findById: jest.Mock<QueryMock<ProductoDocument | null>, unknown[]>;
};

type KardexModelMock = {
  insertMany: jest.Mock<Promise<unknown[]>, unknown[]>;
  create: jest.Mock;
};

type EstadoModelMock = {
  findOne: jest.Mock<QueryMock<EstadoDocument | null>, unknown[]>;
  create: jest.Mock;
};

function producto(
  id: string,
  campos: Partial<Record<keyof Producto, unknown>> = {},
): ProductoDocument {
  return {
    _id: new Types.ObjectId(id),
    nombre_producto: `Producto ${id.slice(-2)}`,
    stock_inicial: 0,
    ...campos,
  } as unknown as ProductoDocument;
}

function facturaBase(
  campos: Partial<FacturaParaInventario> = {},
): FacturaParaInventario {
  return {
    id: 'FAC-000012',
    almacenId: new Types.ObjectId(ALMACEN_ID),
    items: [
      { productoId: PRODUCTO_B, cantidad: 3 },
      { productoId: PRODUCTO_A, cantidad: 2 },
    ],
    ...campos,
  };
}

describe('agregarCantidadesPorProducto', () => {
  it('sums repeated productoIds (case-insensitive hex) and sorts by productoId', () => {
    const lineas = agregarCantidadesPorProducto([
      { productoId: PRODUCTO_B, cantidad: 1 },
      { productoId: PRODUCTO_A, cantidad: 2 },
      { productoId: PRODUCTO_B.toUpperCase(), cantidad: 4 },
    ]);

    expect(lineas).toEqual([
      { productoId: PRODUCTO_A, cantidad: 2 },
      { productoId: PRODUCTO_B, cantidad: 5 },
    ]);
  });
});

describe('FacturaInventarioService', () => {
  let service: FacturaInventarioService;
  let productoModelMock: ProductoModelMock;
  let kardexModelMock: KardexModelMock;
  let estadoModelMock: EstadoModelMock;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    productoModelMock = {
      findOneAndUpdate: jest.fn<
        QueryMock<ProductoDocument | null>,
        unknown[]
      >(),
      updateOne: jest
        .fn<QueryMock<{ matchedCount: number }>, unknown[]>()
        .mockReturnValue(crearQueryMock({ matchedCount: 1 })),
      findById: jest.fn<QueryMock<ProductoDocument | null>, unknown[]>(),
    };
    kardexModelMock = {
      insertMany: jest
        .fn<Promise<unknown[]>, unknown[]>()
        .mockResolvedValue([]),
      create: jest.fn(),
    };
    estadoModelMock = {
      findOne: jest
        .fn<QueryMock<EstadoDocument | null>, unknown[]>()
        .mockReturnValue(crearQueryMock<EstadoDocument | null>(null)),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacturaInventarioService,
        { provide: getModelToken(Producto.name), useValue: productoModelMock },
        { provide: getModelToken(Kardex.name), useValue: kardexModelMock },
        { provide: getModelToken(Estado.name), useValue: estadoModelMock },
      ],
    }).compile();

    service = module.get(FacturaInventarioService);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  /** Resolves each guarded decrement in call order. */
  function decrementosDevuelven(
    ...resultados: (ProductoDocument | null)[]
  ): void {
    for (const resultado of resultados) {
      productoModelMock.findOneAndUpdate.mockReturnValueOnce(
        crearQueryMock(resultado),
      );
    }
  }

  describe('rebajarStock (confirmar)', () => {
    it('decreases each aggregated product once, in productoId order, guarded by stock and warehouse', async () => {
      decrementosDevuelven(
        producto(PRODUCTO_A, { stock_inicial: 8 }),
        producto(PRODUCTO_B, { stock_inicial: 0 }),
      );

      await service.rebajarStock(facturaBase());

      const almacenId = new Types.ObjectId(ALMACEN_ID);
      expect(productoModelMock.findOneAndUpdate.mock.calls).toEqual([
        [
          {
            _id: PRODUCTO_A,
            stock_inicial: { $gte: 2 },
            almacen: { $in: [null, almacenId] },
          },
          { $inc: { stock_inicial: -2 } },
          { new: true },
        ],
        [
          {
            _id: PRODUCTO_B,
            stock_inicial: { $gte: 3 },
            almacen: { $in: [null, almacenId] },
          },
          { $inc: { stock_inicial: -3 } },
          { new: true },
        ],
      ]);
      expect(productoModelMock.updateOne).not.toHaveBeenCalled();
    });

    it('writes one Kardex venta entry per product with the resulting stock and the invoice reference', async () => {
      decrementosDevuelven(
        producto(PRODUCTO_A, { stock_inicial: 8 }),
        producto(PRODUCTO_B, { stock_inicial: 0 }),
      );

      await service.rebajarStock(facturaBase());

      expect(kardexModelMock.insertMany).toHaveBeenCalledWith([
        {
          productoId: new Types.ObjectId(PRODUCTO_A),
          tipo: KardexTipo.VENTA,
          cantidad: 2,
          stock: 8,
          motivo: 'Factura FAC-000012 confirmada',
          referencia: 'FAC-000012',
        },
        {
          productoId: new Types.ObjectId(PRODUCTO_B),
          tipo: KardexTipo.VENTA,
          cantidad: 3,
          stock: 0,
          motivo: 'Factura FAC-000012 confirmada',
          referencia: 'FAC-000012',
        },
      ]);
    });

    it('aggregates a productoId repeated across items into a single decrement', async () => {
      decrementosDevuelven(producto(PRODUCTO_A, { stock_inicial: 1 }));

      await service.rebajarStock(
        facturaBase({
          items: [
            { productoId: PRODUCTO_A, cantidad: 2 },
            { productoId: PRODUCTO_A, cantidad: 3 },
          ],
        }),
      );

      expect(productoModelMock.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(productoModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ stock_inicial: { $gte: 5 } }),
        { $inc: { stock_inicial: -5 } },
        { new: true },
      );
    });

    it('excludes inactive products when the "Inactivo" estado exists, without ever creating it', async () => {
      estadoModelMock.findOne.mockReturnValue(
        crearQueryMock<EstadoDocument | null>({
          _id: new Types.ObjectId(ESTADO_INACTIVO_ID),
        } as unknown as EstadoDocument),
      );
      decrementosDevuelven(producto(PRODUCTO_A), producto(PRODUCTO_B));

      await service.rebajarStock(facturaBase());

      expect(estadoModelMock.findOne).toHaveBeenCalledWith({
        estado: { $regex: /^inactivo$/i },
      });
      expect(estadoModelMock.create).not.toHaveBeenCalled();
      expect(productoModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ estado: { $ne: ESTADO_INACTIVO_ID } }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('does not filter by warehouse for a legacy invoice without almacenId', async () => {
      decrementosDevuelven(producto(PRODUCTO_A), producto(PRODUCTO_B));

      await service.rebajarStock(facturaBase({ almacenId: undefined }));

      expect(productoModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: PRODUCTO_A, stock_inicial: { $gte: 2 } },
        { $inc: { stock_inicial: -2 } },
        { new: true },
      );
    });

    it('on insufficient stock compensates the decrements already applied, writes no Kardex and throws 409 with available vs requested', async () => {
      decrementosDevuelven(producto(PRODUCTO_A, { stock_inicial: 8 }), null);
      productoModelMock.findById.mockReturnValue(
        crearQueryMock<ProductoDocument | null>(
          producto(PRODUCTO_B, {
            nombre_producto: 'Tornillo',
            stock_inicial: 1,
          }),
        ),
      );

      const promesa = service.rebajarStock(facturaBase());

      await expect(promesa).rejects.toBeInstanceOf(ConflictException);
      await expect(promesa).rejects.toThrow(
        `No se puede confirmar la factura FAC-000012: stock insuficiente para el producto "Tornillo" (${PRODUCTO_B}): disponible 1, solicitado 3`,
      );
      expect(productoModelMock.updateOne).toHaveBeenCalledTimes(1);
      expect(productoModelMock.updateOne).toHaveBeenCalledWith(
        { _id: PRODUCTO_A },
        { $inc: { stock_inicial: 2 } },
      );
      expect(kardexModelMock.insertMany).not.toHaveBeenCalled();
    });

    it('names a missing product (including a legacy non-ObjectId productoId) in the 409', async () => {
      decrementosDevuelven(null);
      productoModelMock.findById.mockReturnValue(
        crearQueryMock<ProductoDocument | null>(null),
      );

      await expect(
        service.rebajarStock(
          facturaBase({ items: [{ productoId: PRODUCTO_A, cantidad: 1 }] }),
        ),
      ).rejects.toThrow(`el producto ${PRODUCTO_A} no existe`);

      await expect(
        service.rebajarStock(
          facturaBase({ items: [{ productoId: 'legado-1', cantidad: 1 }] }),
        ),
      ).rejects.toThrow('el producto legado-1 no existe');
      expect(productoModelMock.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('names an inactive product in the 409', async () => {
      estadoModelMock.findOne.mockReturnValue(
        crearQueryMock<EstadoDocument | null>({
          _id: new Types.ObjectId(ESTADO_INACTIVO_ID),
        } as unknown as EstadoDocument),
      );
      decrementosDevuelven(null);
      productoModelMock.findById.mockReturnValue(
        crearQueryMock<ProductoDocument | null>(
          producto(PRODUCTO_A, {
            nombre_producto: 'Tornillo',
            stock_inicial: 50,
            estado: ESTADO_INACTIVO_ID,
          }),
        ),
      );

      await expect(
        service.rebajarStock(
          facturaBase({ items: [{ productoId: PRODUCTO_A, cantidad: 1 }] }),
        ),
      ).rejects.toThrow(`el producto "Tornillo" (${PRODUCTO_A}) está inactivo`);
    });

    it('names a product from another warehouse in the 409', async () => {
      decrementosDevuelven(null);
      productoModelMock.findById.mockReturnValue(
        crearQueryMock<ProductoDocument | null>(
          producto(PRODUCTO_A, {
            nombre_producto: 'Tornillo',
            stock_inicial: 50,
            almacen: new Types.ObjectId(),
          }),
        ),
      );

      await expect(
        service.rebajarStock(
          facturaBase({ items: [{ productoId: PRODUCTO_A, cantidad: 1 }] }),
        ),
      ).rejects.toThrow(
        `el producto "Tornillo" (${PRODUCTO_A}) no pertenece al almacén de la factura`,
      );
    });

    it('logs every failed compensation with invoice, product and quantity, and still throws the 409', async () => {
      decrementosDevuelven(producto(PRODUCTO_A, { stock_inicial: 8 }), null);
      productoModelMock.findById.mockReturnValue(
        crearQueryMock<ProductoDocument | null>(producto(PRODUCTO_B)),
      );
      productoModelMock.updateOne.mockReturnValue(
        crearQueryFallida<{ matchedCount: number }>(new Error('red caida')),
      );

      await expect(service.rebajarStock(facturaBase())).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `factura FAC-000012, producto ${PRODUCTO_A}, cantidad 2`,
        ),
      );
    });

    it('logs a compensation that matches no product (deleted meanwhile)', async () => {
      decrementosDevuelven(producto(PRODUCTO_A, { stock_inicial: 8 }), null);
      productoModelMock.findById.mockReturnValue(
        crearQueryMock<ProductoDocument | null>(producto(PRODUCTO_B)),
      );
      productoModelMock.updateOne.mockReturnValue(
        crearQueryMock({ matchedCount: 0 }),
      );

      await expect(service.rebajarStock(facturaBase())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`producto ${PRODUCTO_A}, cantidad 2`),
      );
    });

    it('compensates and rethrows the original error when a decrement write fails', async () => {
      const fallo = new Error('timeout');
      productoModelMock.findOneAndUpdate
        .mockReturnValueOnce(crearQueryMock(producto(PRODUCTO_A)))
        .mockReturnValueOnce(crearQueryFallida<ProductoDocument | null>(fallo));

      await expect(service.rebajarStock(facturaBase())).rejects.toBe(fallo);
      expect(productoModelMock.updateOne).toHaveBeenCalledWith(
        { _id: PRODUCTO_A },
        { $inc: { stock_inicial: 2 } },
      );
    });

    it('logs a Kardex write failure without rolling back the stock', async () => {
      decrementosDevuelven(producto(PRODUCTO_A), producto(PRODUCTO_B));
      kardexModelMock.insertMany.mockRejectedValue(new Error('validacion'));

      await expect(service.rebajarStock(facturaBase())).resolves.toBe(
        undefined,
      );

      expect(productoModelMock.updateOne).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Kardex venta de la factura FAC-000012'),
      );
    });
  });

  describe('restaurarStock (cancelar)', () => {
    it('increases each aggregated product and writes Kardex devolucion entries', async () => {
      decrementosDevuelven(
        producto(PRODUCTO_A, { stock_inicial: 10 }),
        producto(PRODUCTO_B, { stock_inicial: 3 }),
      );

      await service.restaurarStock(facturaBase());

      expect(productoModelMock.findOneAndUpdate.mock.calls).toEqual([
        [{ _id: PRODUCTO_A }, { $inc: { stock_inicial: 2 } }, { new: true }],
        [{ _id: PRODUCTO_B }, { $inc: { stock_inicial: 3 } }, { new: true }],
      ]);
      expect(kardexModelMock.insertMany).toHaveBeenCalledWith([
        {
          productoId: new Types.ObjectId(PRODUCTO_A),
          tipo: KardexTipo.DEVOLUCION,
          cantidad: 2,
          stock: 10,
          motivo: 'Factura FAC-000012 cancelada',
          referencia: 'FAC-000012',
        },
        {
          productoId: new Types.ObjectId(PRODUCTO_B),
          tipo: KardexTipo.DEVOLUCION,
          cantidad: 3,
          stock: 3,
          motivo: 'Factura FAC-000012 cancelada',
          referencia: 'FAC-000012',
        },
      ]);
    });

    it('warns about a product that no longer exists and continues with the rest', async () => {
      decrementosDevuelven(null, producto(PRODUCTO_B, { stock_inicial: 3 }));

      await service.restaurarStock(facturaBase());

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `factura FAC-000012, producto ${PRODUCTO_A}, cantidad 2`,
        ),
      );
      expect(kardexModelMock.insertMany).toHaveBeenCalledWith([
        expect.objectContaining({
          productoId: new Types.ObjectId(PRODUCTO_B),
          cantidad: 3,
        }),
      ]);
    });

    it('logs a failed increase write and continues with the rest', async () => {
      productoModelMock.findOneAndUpdate
        .mockReturnValueOnce(
          crearQueryFallida<ProductoDocument | null>(new Error('timeout')),
        )
        .mockReturnValueOnce(crearQueryMock(producto(PRODUCTO_B)));

      await service.restaurarStock(facturaBase());

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`producto ${PRODUCTO_A}, cantidad 2`),
      );
      expect(productoModelMock.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });

    it('logs a Kardex write failure without undoing the increase', async () => {
      decrementosDevuelven(producto(PRODUCTO_A), producto(PRODUCTO_B));
      kardexModelMock.insertMany.mockRejectedValue(new Error('validacion'));

      await expect(service.restaurarStock(facturaBase())).resolves.toBe(
        undefined,
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Kardex devolucion de la factura FAC-000012'),
      );
    });
  });
});
