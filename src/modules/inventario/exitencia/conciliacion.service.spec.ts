import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ConciliacionService } from './conciliacion.service';
import { ExistenciaService } from './existencia.service';
import { ResolverConciliacionDto } from './dto/resolver-conciliacion.dto';
import { EstrategiaConciliacion } from './schema/conciliacion-existencia.schema';
import { KardexTipo } from '../kardex/schema/kardex.schema';
import { FakeModel } from './fake-mongo-spec';

/**
 * Pruebas de la conciliación (Fase 1) con modelos en memoria.
 *
 * Catálogo de partida (Central: Estante 1, Estante 2 — Tienda: Vitrina):
 *   ARR-1 Arroz    stock 5   existencias 5 (E1)            → concilia
 *   AZU-1 Azúcar   stock 10  existencias 5 (E1) + 2 (E2)   → difiere (+3)
 *   FRI-1 Frijol   stock 4   sin existencias, defecto E1    → sin ubicación
 *   LEC-1 Leche    stock 3   sin existencias, sin defecto   → sin ubicación
 *   SAL-1 Sal      stock 0   sin existencias                → concilia
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

  const producto = (
    codigo: string,
    nombre: string,
    stock: number,
    conDefecto = true,
  ) => ({
    codigo_producto: codigo,
    nombre_producto: nombre,
    stock_inicial: stock,
    ...(conDefecto ? { almacen: A1, contenedor: C1 } : {}),
  });

  const productos = new FakeModel([
    producto('ARR-1', 'Arroz', 5),
    producto('AZU-1', 'Azúcar', 10),
    producto('FRI-1', 'Frijol', 4),
    producto('LEC-1', 'Leche', 3, false),
    producto('SAL-1', 'Sal', 0),
  ]);
  const [arroz, azucar, frijol, leche, sal] = productos.docs.map(
    (d) => d._id as Types.ObjectId,
  );

  const existencias = new FakeModel([
    { producto: arroz, almacen: A1, contenedor: C1, cantidad: 5 },
    { producto: azucar, almacen: A1, contenedor: C1, cantidad: 5 },
    { producto: azucar, almacen: A1, contenedor: C2, cantidad: 2 },
  ]);

  const kardex = new FakeModel();
  const conciliaciones = new FakeModel();
  const config = new FakeModel();

  const existenciaService = new ExistenciaService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    config as never,
  );
  const servicio = new ConciliacionService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    kardex as never,
    conciliaciones as never,
    existenciaService,
  );

  const dto = (
    productoId: Types.ObjectId,
    estrategia: EstrategiaConciliacion,
    extra: Partial<ResolverConciliacionDto> = {},
  ): ResolverConciliacionDto => ({
    productoId: String(productoId),
    estrategia,
    ...extra,
  });

  const conteo = (
    almacen: Types.ObjectId,
    contenedor: Types.ObjectId,
    cantidad: number,
  ) => ({
    almacenId: String(almacen),
    contenedorId: String(contenedor),
    cantidad,
  });

  return {
    servicio,
    existenciaService,
    almacenes,
    contenedores,
    productos,
    existencias,
    kardex,
    conciliaciones,
    config,
    A1,
    A2,
    C1,
    C2,
    C3,
    arroz,
    azucar,
    frijol,
    leche,
    sal,
    dto,
    conteo,
    stock: (id: Types.ObjectId): number =>
      Number(productos.porId(id)?.stock_inicial),
    fila: (id: Types.ObjectId, contenedor: Types.ObjectId) =>
      existencias.docs.find(
        (d) =>
          String(d.producto) === String(id) &&
          String(d.contenedor) === String(contenedor),
      ),
  };
}

describe('ConciliacionService (Fase 1)', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Reporte ───────────────────────────────────────────────────────
  describe('obtenerReporte', () => {
    it('lista solo los productos que no concilian, ordenados por código', async () => {
      const e = escenario();

      const reporte = await e.servicio.obtenerReporte();

      expect(reporte.unificado).toBe(false);
      expect(reporte.totalProductos).toBe(5);
      expect(reporte.conciliados).toBe(2);
      expect(reporte.conDiferencias).toBe(3);
      expect(reporte.filas.map((f) => f.codigo)).toEqual([
        'AZU-1',
        'FRI-1',
        'LEC-1',
      ]);
    });

    it('un producto con ubicaciones que suman distinto "difiere" y trae el detalle', async () => {
      const e = escenario();

      const [azucar] = (await e.servicio.obtenerReporte()).filas;

      expect(azucar).toMatchObject({
        productoId: String(e.azucar),
        nombre: 'Azúcar',
        stockProducto: 10,
        sumaExistencias: 7,
        diferencia: 3,
        estado: 'difiere',
      });
      expect(azucar.ubicaciones).toEqual([
        {
          almacenId: String(e.A1),
          almacenNombre: 'Central',
          contenedorId: String(e.C1),
          contenedorNombre: 'Estante 1',
          cantidad: 5,
        },
        {
          almacenId: String(e.A1),
          almacenNombre: 'Central',
          contenedorId: String(e.C2),
          contenedorNombre: 'Estante 2',
          cantidad: 2,
        },
      ]);
    });

    it('un producto con stock y sin existencias está "sin_ubicacion" y sugiere su ubicación por defecto', async () => {
      const e = escenario();

      const filas = (await e.servicio.obtenerReporte()).filas;
      const frijol = filas.find((f) => f.codigo === 'FRI-1');
      const leche = filas.find((f) => f.codigo === 'LEC-1');

      expect(frijol?.estado).toBe('sin_ubicacion');
      expect(frijol?.ubicaciones).toEqual([]);
      expect(frijol?.ubicacionPorDefecto).toEqual({
        almacenId: String(e.A1),
        almacenNombre: 'Central',
        contenedorId: String(e.C1),
        contenedorNombre: 'Estante 1',
      });
      expect(leche?.estado).toBe('sin_ubicacion');
      expect(leche?.ubicacionPorDefecto).toBeUndefined();
    });

    it('no sugiere una ubicación por defecto cuyo contenedor es de otro almacén', async () => {
      const e = escenario();
      e.productos.porId(e.frijol)!.almacen = e.A2; // Estante 1 no es de Tienda

      const frijol = (await e.servicio.obtenerReporte()).filas.find(
        (f) => f.codigo === 'FRI-1',
      );

      expect(frijol?.ubicacionPorDefecto).toBeUndefined();
    });

    it('con menos stock que existencias la diferencia es negativa', async () => {
      const e = escenario();
      e.productos.porId(e.arroz)!.stock_inicial = 2;

      const arroz = (await e.servicio.obtenerReporte()).filas.find(
        (f) => f.codigo === 'ARR-1',
      );

      expect(arroz?.diferencia).toBe(-3);
      expect(arroz?.estado).toBe('difiere');
    });

    it('un stock negativo sin existencias es "difiere", no "sin_ubicacion"', async () => {
      const e = escenario();
      e.productos.porId(e.sal)!.stock_inicial = -3;

      const sal = (await e.servicio.obtenerReporte()).filas.find(
        (f) => f.codigo === 'SAL-1',
      );

      expect(sal?.estado).toBe('difiere');
    });

    it('no marca diferencias por residuos de decimales', async () => {
      const e = escenario();
      e.productos.porId(e.arroz)!.stock_inicial = 0.1 + 0.2;
      e.existencias.docs[0].cantidad = 0.3;

      const reporte = await e.servicio.obtenerReporte();

      expect(reporte.filas.find((f) => f.codigo === 'ARR-1')).toBeUndefined();
    });

    it('refleja si el modo unificado ya está activo', async () => {
      const e = escenario();

      await e.existenciaService.activarModoUnificado('admin');
      const reporte = await e.servicio.obtenerReporte();

      expect(reporte.unificado).toBe(true);
      expect(reporte.unificadoPor).toBe('admin');
    });
  });

  // ─── Resolución ────────────────────────────────────────────────────
  describe('resolver — existencias', () => {
    it('las existencias mandan: el stock del producto pasa a su suma, con Kardex y evidencia', async () => {
      const e = escenario();

      const r = await e.servicio.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.EXISTENCIAS, {
          observacion: 'Recuento de julio',
        }),
        'ana',
      );

      expect(r).toEqual({ productoId: String(e.azucar), estado: 'conciliado' });
      expect(e.stock(e.azucar)).toBe(7);
      expect(e.fila(e.azucar, e.C1)?.cantidad).toBe(5); // las existencias no cambian

      expect(e.conciliaciones.docs).toHaveLength(1);
      expect(e.conciliaciones.docs[0]).toMatchObject({
        estrategia: 'existencias',
        usuario: 'ana',
        observacion: 'Recuento de julio',
        stockProductoAntes: 10,
        stockProductoDespues: 7,
        sumaExistenciasAntes: 7,
        sumaExistenciasDespues: 7,
        cambios: [],
      });

      expect(e.kardex.docs).toHaveLength(1);
      expect(e.kardex.docs[0]).toMatchObject({
        productoId: e.azucar,
        tipo: KardexTipo.SALIDA,
        cantidad: 3,
        stock: 7,
        referencia: String(e.conciliaciones.docs[0]._id),
      });
      expect(e.kardex.docs[0].motivo).toContain('Conciliación de existencias');
      expect(e.kardex.docs[0].motivo).toContain('ana');
    });

    it('si las existencias suman más que el stock, el Kardex es una ENTRADA', async () => {
      const e = escenario();
      e.productos.porId(e.arroz)!.stock_inicial = 2;

      await e.servicio.resolver(
        e.dto(e.arroz, EstrategiaConciliacion.EXISTENCIAS),
        'ana',
      );

      expect(e.stock(e.arroz)).toBe(5);
      expect(e.kardex.docs[0]).toMatchObject({
        tipo: KardexTipo.ENTRADA,
        cantidad: 3,
        stock: 5,
      });
    });

    it('el producto resuelto deja de aparecer en el reporte', async () => {
      const e = escenario();

      await e.servicio.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.EXISTENCIAS),
        'ana',
      );

      const reporte = await e.servicio.obtenerReporte();
      expect(reporte.filas.map((f) => f.codigo)).toEqual(['FRI-1', 'LEC-1']);
    });
  });

  describe('resolver — stock_producto', () => {
    it('con una sola ubicación, la existencia se ajusta al stock del producto', async () => {
      const e = escenario();
      e.existencias.docs[0].cantidad = 3; // arroz: stock 5, existencia 3

      await e.servicio.resolver(
        e.dto(e.arroz, EstrategiaConciliacion.STOCK_PRODUCTO),
        'ana',
      );

      expect(e.fila(e.arroz, e.C1)?.cantidad).toBe(5);
      expect(e.stock(e.arroz)).toBe(5);
      expect(e.kardex.docs).toHaveLength(0); // el total del producto no cambió
      expect(e.conciliaciones.docs[0].cambios).toEqual([
        { almacen: e.A1, contenedor: e.C1, antes: 3, despues: 5 },
      ]);
    });

    it('con varias ubicaciones exige un conteo físico y no cambia nada', async () => {
      const e = escenario();

      await expect(
        e.servicio.resolver(
          e.dto(e.azucar, EstrategiaConciliacion.STOCK_PRODUCTO),
          'ana',
        ),
      ).rejects.toThrow('varias ubicaciones');

      expect(e.fila(e.azucar, e.C1)?.cantidad).toBe(5);
      expect(e.fila(e.azucar, e.C2)?.cantidad).toBe(2);
      expect(e.stock(e.azucar)).toBe(10);
      expect(e.conciliaciones.docs).toHaveLength(0);
    });

    it('sin existencias usa la ubicación por defecto del producto', async () => {
      const e = escenario();

      await e.servicio.resolver(
        e.dto(e.frijol, EstrategiaConciliacion.STOCK_PRODUCTO),
        'ana',
      );

      expect(e.fila(e.frijol, e.C1)?.cantidad).toBe(4);
      expect(e.stock(e.frijol)).toBe(4);
      expect(e.conciliaciones.docs[0].cambios).toEqual([
        { almacen: e.A1, contenedor: e.C1, antes: 0, despues: 4 },
      ]);
    });

    it('sin existencias y con ubicación indicada usa la indicada', async () => {
      const e = escenario();

      await e.servicio.resolver(
        e.dto(e.leche, EstrategiaConciliacion.STOCK_PRODUCTO, {
          ubicaciones: [e.conteo(e.A2, e.C3, 0)],
        }),
        'ana',
      );

      expect(e.fila(e.leche, e.C3)?.cantidad).toBe(3);
      expect(e.stock(e.leche)).toBe(3);
    });

    it('sin existencias ni ubicación por defecto pide indicar dónde está', async () => {
      const e = escenario();

      await expect(
        e.servicio.resolver(
          e.dto(e.leche, EstrategiaConciliacion.STOCK_PRODUCTO),
          'ana',
        ),
      ).rejects.toThrow('indique el almacén y el contenedor');

      expect(e.fila(e.leche, e.C1)).toBeUndefined();
    });

    it('rechaza una ubicación cuyo contenedor no es del almacén', async () => {
      const e = escenario();

      await expect(
        e.servicio.resolver(
          e.dto(e.leche, EstrategiaConciliacion.STOCK_PRODUCTO, {
            ubicaciones: [e.conteo(e.A1, e.C3, 0)], // Vitrina es de Tienda
          }),
          'ana',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(e.existencias.docs).toHaveLength(3);
    });

    it('un stock negativo no se puede copiar a las existencias', async () => {
      const e = escenario();
      e.productos.porId(e.sal)!.stock_inicial = -3;

      await expect(
        e.servicio.resolver(
          e.dto(e.sal, EstrategiaConciliacion.STOCK_PRODUCTO),
          'ana',
        ),
      ).rejects.toThrow('negativo');
      expect(e.stock(e.sal)).toBe(-3);
    });
  });

  describe('resolver — conteo físico', () => {
    it('cada ubicación contada queda con su cantidad y las no mencionadas se conservan', async () => {
      const e = escenario();

      await e.servicio.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.CONTEO, {
          ubicaciones: [e.conteo(e.A1, e.C1, 6), e.conteo(e.A2, e.C3, 2)],
        }),
        'ana',
      );

      expect(e.fila(e.azucar, e.C1)?.cantidad).toBe(6);
      expect(e.fila(e.azucar, e.C2)?.cantidad).toBe(2); // no mencionada
      expect(e.fila(e.azucar, e.C3)?.cantidad).toBe(2); // creada
      expect(e.stock(e.azucar)).toBe(10);
      expect(e.kardex.docs).toHaveLength(0); // el total no cambió (6+2+2 = 10)
      expect(e.conciliaciones.docs[0].cambios).toHaveLength(2);
    });

    it('si el conteo baja el total, el stock del producto baja y queda en el Kardex', async () => {
      const e = escenario();

      await e.servicio.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.CONTEO, {
          ubicaciones: [e.conteo(e.A1, e.C1, 1)],
        }),
        'ana',
      );

      expect(e.stock(e.azucar)).toBe(3); // 1 + 2
      expect(e.kardex.docs[0]).toMatchObject({
        tipo: KardexTipo.SALIDA,
        cantidad: 7,
        stock: 3,
      });
      expect(e.conciliaciones.docs[0]).toMatchObject({
        stockProductoAntes: 10,
        stockProductoDespues: 3,
        sumaExistenciasAntes: 7,
        sumaExistenciasDespues: 3,
      });
    });

    it('una ubicación contada en 0 se vacía', async () => {
      const e = escenario();

      await e.servicio.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.CONTEO, {
          ubicaciones: [e.conteo(e.A1, e.C2, 0)],
        }),
        'ana',
      );

      expect(e.fila(e.azucar, e.C2)?.cantidad).toBe(0);
      expect(e.stock(e.azucar)).toBe(5);
    });

    it('exige al menos una ubicación', async () => {
      const e = escenario();

      await expect(
        e.servicio.resolver(
          e.dto(e.azucar, EstrategiaConciliacion.CONTEO, { ubicaciones: [] }),
          'ana',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        e.servicio.resolver(
          e.dto(e.azucar, EstrategiaConciliacion.CONTEO),
          'ana',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza una ubicación repetida sin tocar nada', async () => {
      const e = escenario();

      await expect(
        e.servicio.resolver(
          e.dto(e.azucar, EstrategiaConciliacion.CONTEO, {
            ubicaciones: [e.conteo(e.A1, e.C1, 1), e.conteo(e.A1, e.C1, 2)],
          }),
          'ana',
        ),
      ).rejects.toThrow('repetida');

      expect(e.fila(e.azucar, e.C1)?.cantidad).toBe(5);
      expect(e.stock(e.azucar)).toBe(10);
    });

    it('valida todas las ubicaciones antes de escribir la primera', async () => {
      const e = escenario();

      await expect(
        e.servicio.resolver(
          e.dto(e.azucar, EstrategiaConciliacion.CONTEO, {
            ubicaciones: [
              e.conteo(e.A1, e.C1, 1), // válida
              e.conteo(e.A1, e.C3, 1), // Vitrina no es de Central
            ],
          }),
          'ana',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(e.fila(e.azucar, e.C1)?.cantidad).toBe(5);
      expect(e.conciliaciones.docs).toHaveLength(0);
    });
  });

  describe('resolver — casos comunes', () => {
    it('rechaza un producto que no existe', async () => {
      const e = escenario();

      await expect(
        e.servicio.resolver(
          e.dto(new Types.ObjectId(), EstrategiaConciliacion.EXISTENCIAS),
          'ana',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('si el producto cambia mientras se concilia, avisa con un conflicto y no deja evidencia', async () => {
      const e = escenario();
      // Se guarda el total que pide la conciliación y, justo después, otro
      // cajero vende una unidad: el total deja de coincidir con las existencias.
      jest
        .spyOn(e.existenciaService, 'fijarStockProducto')
        .mockImplementation((_id, stock) => {
          e.productos.porId(e.azucar)!.stock_inicial = stock - 1;
          return Promise.resolve();
        });

      await expect(
        e.servicio.resolver(
          e.dto(e.azucar, EstrategiaConciliacion.EXISTENCIAS),
          'ana',
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(e.conciliaciones.docs).toHaveLength(0);
      expect(e.kardex.docs).toHaveLength(0);
    });

    it('si falla el Kardex, la resolución sigue valiendo y el error queda en el log', async () => {
      const e = escenario();
      e.kardex.create = jest.fn().mockRejectedValue(new Error('kardex caído'));

      const r = await e.servicio.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.EXISTENCIAS),
        'ana',
      );

      expect(r.estado).toBe('conciliado');
      expect(e.conciliaciones.docs).toHaveLength(1);
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('Kardex'));
    });

    it('si falla guardar la evidencia, deja el registro completo en el log y propaga el error', async () => {
      const e = escenario();
      e.conciliaciones.create = jest
        .fn()
        .mockRejectedValue(new Error('disco lleno'));

      await expect(
        e.servicio.resolver(
          e.dto(e.azucar, EstrategiaConciliacion.EXISTENCIAS),
          'ana',
        ),
      ).rejects.toThrow('disco lleno');

      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('"stockProductoAntes":10'),
      );
    });
  });

  // ─── Activación ────────────────────────────────────────────────────
  describe('activar', () => {
    it('se niega mientras queden diferencias y no cambia nada', async () => {
      const e = escenario();

      await expect(e.servicio.activar('admin')).rejects.toThrow(
        'quedan 3 producto(s) con diferencias',
      );

      expect(await e.existenciaService.estaUnificado()).toBe(false);
    });

    it('con 0 diferencias activa el modo unificado y registra quién', async () => {
      const e = escenario();
      await e.servicio.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.EXISTENCIAS),
        'ana',
      );
      await e.servicio.resolver(
        e.dto(e.frijol, EstrategiaConciliacion.STOCK_PRODUCTO),
        'ana',
      );
      await e.servicio.resolver(
        e.dto(e.leche, EstrategiaConciliacion.STOCK_PRODUCTO, {
          ubicaciones: [e.conteo(e.A2, e.C3, 0)],
        }),
        'ana',
      );

      const reporte = await e.servicio.activar('admin');

      expect(reporte.unificado).toBe(true);
      expect(reporte.unificadoPor).toBe('admin');
      expect(reporte.conDiferencias).toBe(0);
      expect(await e.existenciaService.estaUnificado()).toBe(true);
    });

    it('si ya está activo devuelve el estado sin cambiar quién lo activó', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('primero');

      const reporte = await e.servicio.activar('segundo');

      expect(reporte.unificado).toBe(true);
      expect(reporte.unificadoPor).toBe('primero');
    });
  });
});
