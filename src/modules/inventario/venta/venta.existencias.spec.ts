import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { VentaService } from './venta.service';
import { Venta } from './schema/venta.schema';
import { Cliente } from '../../clientes y provedores/cliente/schemas/cliente.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Kardex } from '../kardex/schema/kardex.schema';
import { ReportePlusService } from '../reporte_plus/reporte_plus.service';
import { ExistenciaService } from '../exitencia/existencia.service';
import { StockInsuficienteException } from '../exitencia/stock-insuficiente.exception';

const lean = (v: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(v) }),
});

describe('VentaService -> existencias unificadas (Fase 1)', () => {
  const idA = new Types.ObjectId();
  const idB = new Types.ObjectId();
  const alm = new Types.ObjectId();
  const contA = new Types.ObjectId();
  const contB = new Types.ObjectId();

  let service: VentaService;
  let unificado: boolean;
  let registrarLineas: jest.Mock;
  let existencia: {
    estaUnificado: jest.Mock;
    descontarProducto: jest.Mock;
    reponerProducto: jest.Mock;
  };
  let ventaGuardada: jest.Mock;
  let ventaCreada: Record<string, unknown> | undefined;
  let productoUpdateOne: jest.Mock;
  let productos: Map<string, Record<string, unknown>>;

  const producto = (id: Types.ObjectId, nombre: string, stock: number) => ({
    _id: id,
    codigo_producto: nombre + '1',
    nombre_producto: nombre,
    precio_venta: 100,
    stock_inicial: stock,
    stock_minimo: 0,
    save: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(async () => {
    unificado = true;
    ventaCreada = undefined;
    registrarLineas = jest.fn().mockResolvedValue(undefined);
    ventaGuardada = jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve({ _id: 'venta1' });
    });
    productoUpdateOne = jest
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve({ matchedCount: 1 }) });
    productos = new Map([
      [idA.toString(), producto(idA, 'A', 10)],
      [idB.toString(), producto(idB, 'B', 5)],
    ]);
    existencia = {
      estaUnificado: jest.fn(() => Promise.resolve(unificado)),
      descontarProducto: jest.fn(),
      reponerProducto: jest
        .fn()
        .mockResolvedValue({ ubicaciones: [], stockTotal: 0 }),
    };

    const ventaModel = jest
      .fn()
      .mockImplementation((datos: Record<string, unknown>) => {
        ventaCreada = datos;
        return { ...datos, save: ventaGuardada };
      });

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
            findById: jest.fn((id: string) =>
              Promise.resolve(productos.get(String(id))),
            ),
            updateOne: productoUpdateOne,
          },
        },
        { provide: getModelToken(Kardex.name), useValue: {} },
        {
          provide: getModelToken('Pago'),
          useValue: {
            findById: jest.fn(() => lean({ metodoPago: 'efectivo' })),
          },
        },
        { provide: ReportePlusService, useValue: { registrarLineas } },
        { provide: ExistenciaService, useValue: existencia },
      ],
    }).compile();
    service = mod.get(VentaService);
  });

  const dto = () => ({
    clienteId: new Types.ObjectId().toHexString(),
    productos: [
      { productoId: idA.toString(), cantidad: 2, descuentoMonto: 0 },
      { productoId: idB.toString(), cantidad: 4, descuentoMonto: 0 },
    ],
    subtotal_venta: 600,
    descuento_total: 0,
    impuesto: 0,
    pago: new Types.ObjectId().toHexString(),
  });

  describe('modo unificado', () => {
    it('descuenta de Existencia, no de Producto.stock_inicial, y guarda las ubicaciones en cada línea', async () => {
      existencia.descontarProducto
        .mockResolvedValueOnce({
          ubicaciones: [{ almacen: alm, contenedor: contA, cantidad: 2 }],
          stockTotal: 8,
        })
        .mockResolvedValueOnce({
          ubicaciones: [
            { almacen: alm, contenedor: contA, cantidad: 1 },
            { almacen: alm, contenedor: contB, cantidad: 3 },
          ],
          stockTotal: 1,
        });

      await service.create(dto());

      expect(existencia.descontarProducto.mock.calls).toEqual([
        [{ productoId: idA, cantidad: 2 }],
        [{ productoId: idB, cantidad: 4 }],
      ]);
      // El producto no se toca: ExistenciaService mantiene su total sincronizado.
      expect(productos.get(idA.toString())!.save).not.toHaveBeenCalled();
      expect(productos.get(idB.toString())!.save).not.toHaveBeenCalled();

      const items = (
        ventaCreada as { productos: { ubicaciones?: unknown[] }[] }
      ).productos;
      expect(items[0].ubicaciones).toEqual([
        { almacen: alm, contenedor: contA, cantidad: 2 },
      ]);
      expect(items[1].ubicaciones).toHaveLength(2);

      const [[lineas]] = registrarLineas.mock.calls as [
        { stockFinal: number }[],
      ][];
      expect(lineas.map((l) => l.stockFinal)).toEqual([8, 1]);
    });

    it('si el segundo producto no tiene stock devuelve el primero y no guarda la venta', async () => {
      const ubicacionesA = [{ almacen: alm, contenedor: contA, cantidad: 2 }];
      existencia.descontarProducto
        .mockResolvedValueOnce({ ubicaciones: ubicacionesA, stockTotal: 8 })
        .mockRejectedValueOnce(new StockInsuficienteException('"B"', 1, 4));

      await expect(service.create(dto())).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(existencia.reponerProducto).toHaveBeenCalledTimes(1);
      expect(existencia.reponerProducto).toHaveBeenCalledWith({
        productoId: idA,
        ubicaciones: ubicacionesA,
      });
      expect(ventaGuardada).not.toHaveBeenCalled();
      expect(registrarLineas).not.toHaveBeenCalled();
    });

    it('si falla el guardado de la venta devuelve todo lo descontado', async () => {
      const ubicacionesA = [{ almacen: alm, contenedor: contA, cantidad: 2 }];
      const ubicacionesB = [{ almacen: alm, contenedor: contB, cantidad: 4 }];
      existencia.descontarProducto
        .mockResolvedValueOnce({ ubicaciones: ubicacionesA, stockTotal: 8 })
        .mockResolvedValueOnce({ ubicaciones: ubicacionesB, stockTotal: 1 });
      ventaGuardada.mockRejectedValue(new Error('mongo caído'));

      await expect(service.create(dto())).rejects.toThrow('mongo caído');

      expect(existencia.reponerProducto.mock.calls).toEqual([
        [{ productoId: idA, ubicaciones: ubicacionesA }],
        [{ productoId: idB, ubicaciones: ubicacionesB }],
      ]);
    });

    it('un fallo al devolver el stock no oculta el error original de la venta', async () => {
      existencia.descontarProducto.mockResolvedValue({
        ubicaciones: [{ almacen: alm, contenedor: contA, cantidad: 2 }],
        stockTotal: 8,
      });
      existencia.reponerProducto.mockRejectedValue(new Error('no se pudo'));
      ventaGuardada.mockRejectedValue(new Error('venta falló'));

      await expect(service.create(dto())).rejects.toThrow('venta falló');
    });
  });

  describe('modo anterior (sin unificar)', () => {
    beforeEach(() => {
      unificado = false;
    });

    it('descuenta Producto.stock_inicial como siempre y no usa Existencia', async () => {
      await service.create(dto());

      expect(productos.get(idA.toString())!.stock_inicial).toBe(8);
      expect(productos.get(idB.toString())!.stock_inicial).toBe(1);
      expect(existencia.descontarProducto).not.toHaveBeenCalled();
      const items = (ventaCreada as { productos: { ubicaciones?: unknown }[] })
        .productos;
      expect(items[0].ubicaciones).toBeUndefined();
    });

    it('si el segundo producto no tiene stock devuelve el stock del primero', async () => {
      productos.get(idB.toString())!.stock_inicial = 1;

      await expect(service.create(dto())).rejects.toThrow(
        'Stock insuficiente para B',
      );

      expect(productoUpdateOne).toHaveBeenCalledWith(
        { _id: idA },
        { $inc: { stock_inicial: 2 } },
      );
      expect(ventaGuardada).not.toHaveBeenCalled();
    });

    it('si falla el guardado de la venta devuelve el stock de todos', async () => {
      ventaGuardada.mockRejectedValue(new Error('mongo caído'));

      await expect(service.create(dto())).rejects.toThrow('mongo caído');

      expect(productoUpdateOne).toHaveBeenCalledTimes(2);
    });
  });
});
