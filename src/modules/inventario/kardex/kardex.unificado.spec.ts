import { BadRequestException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { KardexService } from './kardex.service';
import { KardexTipo } from './schema/kardex.schema';
import { CreateKardexDto } from './dto/create-kardex.dto';
import { ExistenciaService } from '../exitencia/existencia.service';
import { StockInsuficienteException } from '../exitencia/stock-insuficiente.exception';
import { FakeModel } from '../exitencia/fake-mongo-spec';

/**
 * Ajuste manual de inventario (KardexService.create) antes y después de
 * activar el modo unificado de la Fase 1.
 *
 * Producto "Arroz": 10 unidades, ubicación por defecto Central / Estante 1.
 *   Central: Estante 1 = 6, Estante 2 = 3      Tienda: Vitrina = 1
 */
function escenario() {
  const almacenes = new FakeModel([
    { nombreAlmacen: 'Central' },
    { nombreAlmacen: 'Tienda' },
  ]);
  const [A1, A2] = almacenes.docs.map((d) => d._id as Types.ObjectId);
  const contenedores = new FakeModel([
    { nombreContenedor: 'Estante 1', almacen: A1 },
    { nombreContenedor: 'Estante 2', almacen: A1 },
    { nombreContenedor: 'Vitrina', almacen: A2 },
  ]);
  const [C1, C2, C3] = contenedores.docs.map((d) => d._id as Types.ObjectId);
  const productos = new FakeModel([
    {
      codigo_producto: 'ARR-1',
      nombre_producto: 'Arroz',
      stock_inicial: 10,
      almacen: A1,
      contenedor: C1,
    },
  ]);
  const P = productos.docs[0]._id as Types.ObjectId;
  const existencias = new FakeModel([
    { producto: P, almacen: A1, contenedor: C1, cantidad: 6 },
    { producto: P, almacen: A1, contenedor: C2, cantidad: 3 },
    { producto: P, almacen: A2, contenedor: C3, cantidad: 1 },
  ]);
  const config = new FakeModel();
  const kardex = new FakeModel();
  const estadoInactivo = new Types.ObjectId();
  const nomencladorHelper = {
    findOrCreateEstado: jest.fn().mockResolvedValue(estadoInactivo),
  };

  const existenciaService = new ExistenciaService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    config as never,
  );
  const servicio = new KardexService(
    kardex as never,
    productos as never,
    nomencladorHelper as never,
    existenciaService,
  );

  const dto = (extra: Partial<CreateKardexDto>): CreateKardexDto => ({
    productoId: String(P),
    tipo: KardexTipo.SALIDA,
    cantidad: 1,
    motivo: 'Ajuste de prueba',
    ...extra,
  });

  return {
    servicio,
    existenciaService,
    existencias,
    productos,
    kardex,
    nomencladorHelper,
    estadoInactivo,
    A1,
    A2,
    C1,
    C2,
    C3,
    P,
    dto,
    cantidad: (c: Types.ObjectId): number | undefined => {
      const fila = existencias.docs.find(
        (d) => String(d.contenedor) === String(c),
      );
      return fila ? Number(fila.cantidad) : undefined;
    },
    stock: (): number => Number(productos.docs[0].stock_inicial),
  };
}

describe('KardexService.create — ajuste de inventario', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('antes de activar el modo unificado (comportamiento de siempre)', () => {
    it('una salida solo baja el stock del producto y no toca las existencias', async () => {
      const e = escenario();

      const k = await e.servicio.create(
        e.dto({ tipo: KardexTipo.SALIDA, cantidad: 3 }),
      );

      expect(e.stock()).toBe(7);
      expect(k.stock).toBe(7);
      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.cantidad(e.C2)).toBe(3);
      expect(e.cantidad(e.C3)).toBe(1);
    });

    it('una entrada solo sube el stock del producto', async () => {
      const e = escenario();

      await e.servicio.create(e.dto({ tipo: KardexTipo.ENTRADA, cantidad: 5 }));

      expect(e.stock()).toBe(15);
      expect(e.cantidad(e.C1)).toBe(6);
    });

    it('rechaza una salida mayor que el stock', async () => {
      const e = escenario();

      await expect(
        e.servicio.create(e.dto({ tipo: KardexTipo.SALIDA, cantidad: 11 })),
      ).rejects.toThrow('Stock insuficiente');
      expect(e.stock()).toBe(10);
    });
  });

  describe('con el modo unificado activo', () => {
    it('una entrada va a la ubicación por defecto y deja el kardex con el total', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      const k = await e.servicio.create(
        e.dto({ tipo: KardexTipo.ENTRADA, cantidad: 5 }),
      );

      expect(e.cantidad(e.C1)).toBe(11);
      expect(e.stock()).toBe(15);
      expect(k.stock).toBe(15);
      expect(e.kardex.docs).toHaveLength(1);
      expect(e.kardex.docs[0]).toMatchObject({
        tipo: KardexTipo.ENTRADA,
        cantidad: 5,
        stock: 15,
        motivo: 'Ajuste de prueba',
      });
    });

    it('una entrada puede indicar la ubicación', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await e.servicio.create(
        e.dto({
          tipo: KardexTipo.ENTRADA,
          cantidad: 2,
          almacenId: String(e.A2),
          contenedorId: String(e.C3),
        }),
      );

      expect(e.cantidad(e.C3)).toBe(3);
      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.stock()).toBe(12);
    });

    it('una salida se reparte entre las ubicaciones del producto', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      const k = await e.servicio.create(
        e.dto({ tipo: KardexTipo.SALIDA, cantidad: 8 }),
      );

      expect(e.cantidad(e.C1)).toBe(0);
      expect(e.cantidad(e.C2)).toBe(1);
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(2);
      expect(k.stock).toBe(2);
    });

    it('una salida con ubicación solo toma de ella y, si no alcanza, no registra nada', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.create(
          e.dto({
            tipo: KardexTipo.SALIDA,
            cantidad: 2,
            almacenId: String(e.A2),
            contenedorId: String(e.C3),
          }),
        ),
      ).rejects.toBeInstanceOf(StockInsuficienteException);

      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(10);
      expect(e.kardex.docs).toHaveLength(0);
    });

    it('solo admite entradas y salidas manuales', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.create(e.dto({ tipo: KardexTipo.VENTA })),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(e.stock()).toBe(10);
      expect(e.kardex.docs).toHaveLength(0);
    });

    it('si el kardex no se puede guardar, deshace la salida', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      e.kardex.create = jest.fn().mockRejectedValue(new Error('kardex caído'));

      await expect(
        e.servicio.create(e.dto({ tipo: KardexTipo.SALIDA, cantidad: 8 })),
      ).rejects.toThrow('kardex caído');

      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.cantidad(e.C2)).toBe(3);
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(10);
    });

    it('si el kardex no se puede guardar, deshace la entrada', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      e.kardex.create = jest.fn().mockRejectedValue(new Error('kardex caído'));

      await expect(
        e.servicio.create(e.dto({ tipo: KardexTipo.ENTRADA, cantidad: 4 })),
      ).rejects.toThrow('kardex caído');

      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.stock()).toBe(10);
    });

    it('al quedar el producto en 0 lo marca como inactivo', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await e.servicio.create(e.dto({ tipo: KardexTipo.SALIDA, cantidad: 10 }));

      expect(e.nomencladorHelper.findOrCreateEstado).toHaveBeenCalledWith(
        'Inactivo',
      );
      expect(String(e.productos.docs[0].estado)).toBe(String(e.estadoInactivo));
    });

    it('un kardex ya registrado no se edita', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.update(String(new Types.ObjectId()), { cantidad: 3 }),
      ).rejects.toThrow('no se modifican');
    });

    it('sigue validando el producto y la cantidad', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.create(e.dto({ productoId: 'no-es-id' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        e.servicio.create(e.dto({ cantidad: 0 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        e.servicio.create(e.dto({ productoId: String(new Types.ObjectId()) })),
      ).rejects.toThrow('No se encontró el producto');
    });
  });
});
