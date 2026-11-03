import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductoService } from './producto.service';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { CreateProductoDto } from './dto/create-producto.dto';
import { ExistenciaService } from '../exitencia/existencia.service';
import { FakeModel } from '../exitencia/fake-mongo-spec';

/**
 * ProductoService.update: en el modo unificado el stock se mueve solo con
 * ventas, compras, transferencias y ajustes; editarlo desde la ficha del
 * producto lo desincronizaría de las existencias.
 */
function escenario() {
  const productos = new FakeModel([
    {
      codigo_producto: 'ARR-1',
      nombre_producto: 'Arroz',
      stock_inicial: 10,
      precio_venta: 100,
    },
  ]);
  const P = productos.docs[0]._id as Types.ObjectId;
  const config = new FakeModel();
  const vacio = new FakeModel();
  const existenciaService = new ExistenciaService(
    vacio as never,
    productos as never,
    vacio as never,
    vacio as never,
    config as never,
  );
  const servicio = new ProductoService(
    productos as never,
    vacio as never,
    vacio as never,
    vacio as never,
    vacio as never,
    {} as never,
    existenciaService,
  );

  return {
    servicio,
    existenciaService,
    productos,
    P,
    producto: () => productos.docs[0],
  };
}

const dto = (campos: Record<string, unknown>) => campos as UpdateProductoDto;

describe('ProductoService.update y el modo unificado (Fase 1)', () => {
  describe('antes de activarlo', () => {
    it('permite cambiar el stock como siempre', async () => {
      const e = escenario();

      await e.servicio.update(String(e.P), dto({ stock_inicial: 12 }));

      expect(e.producto().stock_inicial).toBe(12);
    });
  });

  describe('con el modo unificado activo', () => {
    it('rechaza un cambio de stock y no toca nada', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.update(
          String(e.P),
          dto({ stock_inicial: 12, nombre_producto: 'Otro' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(e.producto().stock_inicial).toBe(10);
      expect(e.producto().nombre_producto).toBe('Arroz');
    });

    it('si reenvía el mismo stock lo ignora y aplica el resto de cambios', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await e.servicio.update(
        String(e.P),
        dto({ stock_inicial: 10, nombre_producto: 'Arroz grano largo' }),
      );

      expect(e.producto().stock_inicial).toBe(10);
      expect(e.producto().nombre_producto).toBe('Arroz grano largo');
    });

    it('sin tocar el stock edita con normalidad', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await e.servicio.update(String(e.P), dto({ precio_venta: 150 }));

      expect(e.producto().precio_venta).toBe(150);
    });

    it('un producto que no existe da 404', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.update(
          String(new Types.ObjectId()),
          dto({ stock_inicial: 1 }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('crear producto con el modo unificado activo', () => {
    const nuevo = (extra: Record<string, unknown> = {}) =>
      ({
        codigo_producto: 'NUE-1',
        nombre_producto: 'Nuevo',
        categoria_producto: 'cat',
        precio_compra: 1,
        precio_venta: 2,
        stock_inicial: 5,
        stock_minimo: 0,
        estado: 'activo',
        ...extra,
      }) as CreateProductoDto;

    it('rechaza un stock inicial sin ubicación y no crea el producto', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      const antes = e.productos.docs.length;

      await expect(e.servicio.create(nuevo())).rejects.toThrow(
        'necesita almacén y contenedor',
      );

      expect(e.productos.docs).toHaveLength(antes);
    });

    it('un almacén sin contenedor tampoco basta', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.create(nuevo({ almacen: String(new Types.ObjectId()) })),
      ).rejects.toBeInstanceOf(Error);
      expect(e.productos.docs).toHaveLength(1);
    });
  });
});
