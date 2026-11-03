/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { ConflictException, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConciliacionService } from './conciliacion.service';
import { ExistenciaService } from './existencia.service';
import { ResolverConciliacionDto } from './dto/resolver-conciliacion.dto';
import { EstrategiaConciliacion } from './schema/conciliacion-existencia.schema';
import { StockInsuficienteException } from './stock-insuficiente.exception';
import { FakeModel } from './fake-mongo-spec';

/**
 * La Fase 1 con los datos tal como están en la base REAL.
 *
 * Casi todos los esquemas declaran los ids como `Mixed`, así que Mongoose los
 * guarda tal cual llegan, y el formulario manda cada id como TEXTO. Por eso:
 *
 *  - `contenedores.almacen`, `productos.almacen` y `productos.contenedor`
 *    están guardados como texto;
 *  - las existencias que crea el alta de un producto con stock (o una
 *    transferencia) tienen sus ids como ObjectId;
 *  - las que creaba `sincronizarUbicacionInicial` copiando el producto (los
 *    productos anteriores a la colección `existencias`) tienen almacén y
 *    contenedor como texto.
 *
 * Las demás pruebas siembran ObjectId en todo y no lo habrían detectado: con
 * texto en `contenedores.almacen`, "Contar" fallaba siempre con "El contenedor
 * no existe o no pertenece al almacén indicado".
 *
 * Catálogo (Central: Estante 1, Estante 2 — Tienda: Vitrina):
 *   ARR-1 Arroz    stock 5   fila 5 (E1) con ids de TEXTO              → concilia
 *   HAR-1 Harina   stock 10  fila 4 (E1, texto) + fila 3 (E1, ObjectId)
 *                            = la misma ubicación en dos filas        → difiere (+3)
 *   FRI-1 Frijol   stock 4   sin existencias, defecto E1 (texto)       → sin ubicación
 *   LEC-1 Leche    stock 3   sin existencias, sin defecto              → sin ubicación
 *   AZU-1 Azúcar   stock 10  5 (E1) + 2 (E2), ObjectId                 → difiere (+3)
 */

const texto = (id: unknown): string => String(id);

function datosAntiguos() {
  const almacenes = new FakeModel([
    { nombreAlmacen: 'Central' },
    { nombreAlmacen: 'Tienda' },
  ]);
  const [A1, A2] = almacenes.docs.map((d) => d._id as Types.ObjectId);

  const contenedores = new FakeModel([
    { nombreContenedor: 'Estante 1', almacen: texto(A1) },
    { nombreContenedor: 'Estante 2', almacen: texto(A1) },
    { nombreContenedor: 'Vitrina', almacen: texto(A2) },
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
    ...(conDefecto ? { almacen: texto(A1), contenedor: texto(C1) } : {}),
  });

  const productos = new FakeModel([
    producto('ARR-1', 'Arroz', 5),
    producto('HAR-1', 'Harina', 10),
    producto('FRI-1', 'Frijol', 4),
    producto('LEC-1', 'Leche', 3, false),
    producto('AZU-1', 'Azúcar', 10),
  ]);
  const [arroz, harina, frijol, leche, azucar] = productos.docs.map(
    (d) => d._id as Types.ObjectId,
  );

  // Índice único como el de la colección real: un id de texto y el mismo id
  // como ObjectId son valores distintos y conviven.
  const existencias = new FakeModel(
    [
      {
        producto: arroz,
        almacen: texto(A1),
        contenedor: texto(C1),
        cantidad: 5,
      },
      {
        producto: harina,
        almacen: texto(A1),
        contenedor: texto(C1),
        cantidad: 4,
      },
      { producto: harina, almacen: A1, contenedor: C1, cantidad: 3 },
      { producto: azucar, almacen: A1, contenedor: C1, cantidad: 5 },
      { producto: azucar, almacen: A1, contenedor: C2, cantidad: 2 },
    ],
    { unico: ['producto', 'almacen', 'contenedor'] },
  );

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
  const conciliacion = new ConciliacionService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    kardex as never,
    conciliaciones as never,
    existenciaService,
  );

  const esId = (v: unknown): boolean => v instanceof Types.ObjectId;

  return {
    existenciaService,
    conciliacion,
    existencias,
    productos,
    kardex,
    config,
    A1,
    A2,
    C1,
    C2,
    C3,
    arroz,
    harina,
    frijol,
    leche,
    azucar,
    filas: (id: Types.ObjectId) =>
      existencias.docs.filter((d) => String(d.producto) === String(id)),
    suma: (id: Types.ObjectId): number =>
      existencias.docs
        .filter((d) => String(d.producto) === String(id))
        .reduce((s, d) => s + Number(d.cantidad), 0),
    stock: (id: Types.ObjectId): number =>
      Number(productos.porId(id)?.stock_inicial),
    /** ¿Los tres ids de todas las filas del producto están como ObjectId? */
    todoObjectId: (id: Types.ObjectId): boolean =>
      existencias.docs
        .filter((d) => String(d.producto) === String(id))
        .every(
          (d) => esId(d.producto) && esId(d.almacen) && esId(d.contenedor),
        ),
    dto: (
      productoId: Types.ObjectId,
      estrategia: EstrategiaConciliacion,
      ubicaciones?: {
        almacen: Types.ObjectId;
        contenedor: Types.ObjectId;
        cantidad: number;
      }[],
    ): ResolverConciliacionDto => ({
      productoId: texto(productoId),
      estrategia,
      ...(ubicaciones
        ? {
            ubicaciones: ubicaciones.map((u) => ({
              almacenId: texto(u.almacen),
              contenedorId: texto(u.contenedor),
              cantidad: u.cantidad,
            })),
          }
        : {}),
    }),
  };
}

describe('Fase 1 con ids guardados como texto (datos antiguos)', () => {
  let logWarn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ─── ExistenciaService ────────────────────────────────────────────

  describe('descontarProducto', () => {
    it('sin ubicación toma de la fila con ids de texto y devuelve ObjectId', async () => {
      const e = datosAntiguos();

      const r = await e.existenciaService.descontarProducto({
        productoId: e.arroz,
        cantidad: 2,
      });

      expect(e.suma(e.arroz)).toBe(3);
      expect(e.stock(e.arroz)).toBe(3);
      expect(r.stockTotal).toBe(3);
      expect(r.ubicaciones).toHaveLength(1);
      expect(r.ubicaciones[0].almacen).toBeInstanceOf(Types.ObjectId);
      expect(r.ubicaciones[0].contenedor).toBeInstanceOf(Types.ObjectId);
    });

    it('con ubicación indicada encuentra la fila con ids de texto', async () => {
      const e = datosAntiguos();

      await e.existenciaService.descontarProducto({
        productoId: texto(e.arroz),
        cantidad: 1,
        almacenId: texto(e.A1),
        contenedorId: texto(e.C1),
      });

      expect(e.suma(e.arroz)).toBe(4);
    });

    it('con una ubicación en la que no hay stock dice cuánto hay allí', async () => {
      const e = datosAntiguos();

      await expect(
        e.existenciaService.descontarProducto({
          productoId: e.arroz,
          cantidad: 1,
          almacenId: texto(e.A1),
          contenedorId: texto(e.C2),
        }),
      ).rejects.toBeInstanceOf(StockInsuficienteException);
      expect(e.suma(e.arroz)).toBe(5);
    });

    it('reparte entre la fila de texto y la de ObjectId de una misma ubicación', async () => {
      const e = datosAntiguos();

      await e.existenciaService.descontarProducto({
        productoId: e.harina,
        cantidad: 6,
      });

      expect(e.suma(e.harina)).toBe(1);
      expect(e.stock(e.harina)).toBe(4);
    });
  });

  describe('reponerProducto', () => {
    it('sin ubicación suma sobre la fila existente en vez de abrir otra', async () => {
      const e = datosAntiguos();

      await e.existenciaService.reponerProducto({
        productoId: e.arroz,
        cantidad: 2,
      });

      expect(e.filas(e.arroz)).toHaveLength(1);
      expect(e.suma(e.arroz)).toBe(7);
      expect(e.stock(e.arroz)).toBe(7);
    });

    it('sin fila previa crea una sola fila, con ObjectId, en la ubicación por defecto', async () => {
      const e = datosAntiguos();

      await e.existenciaService.reponerProducto({
        productoId: e.frijol,
        cantidad: 4,
      });

      const filas = e.filas(e.frijol);

      expect(filas).toHaveLength(1);
      expect(filas[0].cantidad).toBe(4);
      expect(texto(filas[0].almacen)).toBe(texto(e.A1));
      expect(texto(filas[0].contenedor)).toBe(texto(e.C1));
      expect(e.todoObjectId(e.frijol)).toBe(true);
    });

    it('con un contenedor indicado toma su almacén de `contenedores.almacen` (texto) y guarda ObjectId', async () => {
      const e = datosAntiguos();

      await e.existenciaService.reponerProducto({
        productoId: e.leche,
        cantidad: 3,
        contenedorId: texto(e.C3),
      });

      const [fila] = e.filas(e.leche);

      expect(texto(fila.almacen)).toBe(texto(e.A2));
      expect(e.todoObjectId(e.leche)).toBe(true);
    });

    it('reponer a las ubicaciones exactas (cancelar factura) vuelve a la fila con ids de texto', async () => {
      const e = datosAntiguos();

      await e.existenciaService.reponerProducto({
        productoId: e.arroz,
        ubicaciones: [{ almacen: e.A1, contenedor: e.C1, cantidad: 2 }],
      });

      expect(e.filas(e.arroz)).toHaveLength(1);
      expect(e.suma(e.arroz)).toBe(7);
    });

    it('dos reposiciones simultáneas a una ubicación nueva suman las dos y dejan una sola fila', async () => {
      const e = datosAntiguos();

      await Promise.all([
        e.existenciaService.reponerProducto({
          productoId: e.frijol,
          cantidad: 1,
        }),
        e.existenciaService.reponerProducto({
          productoId: e.frijol,
          cantidad: 2,
        }),
      ]);

      expect(e.filas(e.frijol)).toHaveLength(1);
      expect(e.suma(e.frijol)).toBe(3);
      expect(e.stock(e.frijol)).toBe(7);
    });
  });

  describe('fijarCantidad y sumarExistencias', () => {
    it('fijarCantidad actualiza en sitio la fila con ids de texto y devuelve la cantidad anterior', async () => {
      const e = datosAntiguos();

      const anterior = await e.existenciaService.fijarCantidad(
        e.arroz,
        e.A1,
        e.C1,
        8,
      );

      expect(anterior).toBe(5);
      expect(e.filas(e.arroz)).toHaveLength(1);
      expect(e.suma(e.arroz)).toBe(8);
    });

    it('fijarCantidad crea la fila con ObjectId si la ubicación no tenía', async () => {
      const e = datosAntiguos();

      const anterior = await e.existenciaService.fijarCantidad(
        e.frijol,
        e.A1,
        e.C1,
        4,
      );

      expect(anterior).toBe(0);
      expect(e.filas(e.frijol)).toHaveLength(1);
      expect(e.todoObjectId(e.frijol)).toBe(true);
    });

    it('sumarExistencias cuenta las filas con ids de texto', async () => {
      const e = datosAntiguos();

      expect(await e.existenciaService.sumarExistencias(e.harina)).toBe(7);
    });
  });

  describe('sincronizarUbicacionInicial (productos anteriores a las existencias)', () => {
    type ConSincronizar = {
      sincronizarUbicacionInicial: (p: unknown) => Promise<void>;
    };

    it('crea la fila con ObjectId aunque el producto guarde su ubicación como texto', async () => {
      const e = datosAntiguos();
      const producto = e.productos.porId(e.frijol)!;

      await (
        e.existenciaService as unknown as ConSincronizar
      ).sincronizarUbicacionInicial(producto);

      const [fila] = e.filas(e.frijol);

      expect(fila.cantidad).toBe(4);
      expect(e.todoObjectId(e.frijol)).toBe(true);
    });

    it('no crea nada si el contenedor no pertenece al almacén del producto', async () => {
      const e = datosAntiguos();
      const producto = {
        ...e.productos.porId(e.frijol)!,
        almacen: texto(e.A2),
      };

      await (
        e.existenciaService as unknown as ConSincronizar
      ).sincronizarUbicacionInicial(producto);

      expect(e.filas(e.frijol)).toHaveLength(0);
    });

    it('no vuelve a crearla si el producto ya tiene alguna fila', async () => {
      const e = datosAntiguos();
      const producto = e.productos.porId(e.arroz)!;

      await (
        e.existenciaService as unknown as ConSincronizar
      ).sincronizarUbicacionInicial(producto);

      expect(e.filas(e.arroz)).toHaveLength(1);
    });
  });

  // ─── normalizarExistencias ────────────────────────────────────────

  describe('normalizarExistencias', () => {
    it('convierte los ids de texto a ObjectId sin cambiar la cantidad', async () => {
      const e = datosAntiguos();

      const r = await e.existenciaService.normalizarExistencias(e.arroz);

      expect(r).toEqual({ convertidas: 1, fusionadas: 0 });
      expect(e.filas(e.arroz)).toHaveLength(1);
      expect(e.suma(e.arroz)).toBe(5);
      expect(e.todoObjectId(e.arroz)).toBe(true);
    });

    it('suma en una sola fila la ubicación repetida (texto + ObjectId)', async () => {
      const e = datosAntiguos();
      const conservada = e
        .filas(e.harina)
        .find((f) => f.almacen instanceof Types.ObjectId);

      const r = await e.existenciaService.normalizarExistencias(e.harina);

      expect(r).toEqual({ convertidas: 0, fusionadas: 1 });
      expect(e.filas(e.harina)).toHaveLength(1);
      expect(e.filas(e.harina)[0]._id).toBe(conservada!._id);
      expect(e.suma(e.harina)).toBe(7);
      expect(e.todoObjectId(e.harina)).toBe(true);
    });

    it('sin producto revisa todas las filas, y no toca las que ya están bien', async () => {
      const e = datosAntiguos();
      const azucarAntes = JSON.stringify(e.filas(e.azucar));

      const r = await e.existenciaService.normalizarExistencias();

      expect(r).toEqual({ convertidas: 1, fusionadas: 1 });
      expect(e.todoObjectId(e.arroz) && e.todoObjectId(e.harina)).toBe(true);
      expect(JSON.stringify(e.filas(e.azucar))).toBe(azucarAntes);
    });

    it('con un producto no toca los demás', async () => {
      const e = datosAntiguos();

      await e.existenciaService.normalizarExistencias(e.harina);

      expect(e.todoObjectId(e.arroz)).toBe(false);
    });

    it('es idempotente: la segunda vez no cambia ni escribe nada', async () => {
      const e = datosAntiguos();
      await e.existenciaService.normalizarExistencias();
      const escrituras = e.existencias.escrituras;
      const foto = JSON.stringify(e.existencias.docs);

      const r = await e.existenciaService.normalizarExistencias();

      expect(r).toEqual({ convertidas: 0, fusionadas: 0 });
      expect(e.existencias.escrituras).toBe(escrituras);
      expect(JSON.stringify(e.existencias.docs)).toBe(foto);
    });

    it('si falla al escribir devuelve las filas que había retirado: no se pierde cantidad', async () => {
      const e = datosAntiguos();
      const idsAntes = e
        .filas(e.harina)
        .map((f) => texto(f._id))
        .sort();
      e.existencias.fallarSi = (_filtro, update) =>
        update.$set?.almacen ? new Error('se cayó la red') : undefined;

      await expect(
        e.existenciaService.normalizarExistencias(e.harina),
      ).rejects.toThrow('se cayó la red');

      expect(e.suma(e.harina)).toBe(7);
      expect(
        e
          .filas(e.harina)
          .map((f) => texto(f._id))
          .sort(),
      ).toEqual(idsAntes);
    });

    it('una fila con ids que no son válidos se deja como está y se avisa', async () => {
      const e = datosAntiguos();
      e.existencias.insertar({
        producto: e.leche,
        almacen: 'no-es-un-id',
        contenedor: 'tampoco',
        cantidad: 3,
      });

      const r = await e.existenciaService.normalizarExistencias(e.leche);

      expect(r).toEqual({ convertidas: 0, fusionadas: 0 });
      expect(e.filas(e.leche)).toHaveLength(1);
      expect(logWarn).toHaveBeenCalled();
    });
  });

  // ─── ConciliacionService ──────────────────────────────────────────

  describe('reporte de conciliación', () => {
    it('junta en una sola ubicación las filas repetidas de texto y ObjectId, con sus nombres', async () => {
      const e = datosAntiguos();

      const reporte = await e.conciliacion.obtenerReporte();
      const harina = reporte.filas.find((f) => f.codigo === 'HAR-1')!;

      expect(harina.ubicaciones).toEqual([
        {
          almacenId: texto(e.A1),
          almacenNombre: 'Central',
          contenedorId: texto(e.C1),
          contenedorNombre: 'Estante 1',
          cantidad: 7,
        },
      ]);
      expect(harina.sumaExistencias).toBe(7);
      expect(harina.diferencia).toBe(3);
      expect(harina.estado).toBe('difiere');
    });

    it('propone la ubicación por defecto aunque el producto la guarde como texto', async () => {
      const e = datosAntiguos();

      const reporte = await e.conciliacion.obtenerReporte();
      const frijol = reporte.filas.find((f) => f.codigo === 'FRI-1')!;

      expect(frijol.estado).toBe('sin_ubicacion');
      expect(frijol.ubicacionPorDefecto).toMatchObject({
        almacenNombre: 'Central',
        contenedorNombre: 'Estante 1',
      });
    });

    it('no escribe nada: solo lee', async () => {
      const e = datosAntiguos();
      const foto = JSON.stringify(e.existencias.docs);

      await e.conciliacion.obtenerReporte();

      expect(JSON.stringify(e.existencias.docs)).toBe(foto);
      expect(e.existencias.escrituras).toBe(0);
    });

    it('los productos con la fila de texto que ya cuadran no aparecen', async () => {
      const e = datosAntiguos();

      const reporte = await e.conciliacion.obtenerReporte();

      expect(reporte.filas.map((f) => f.codigo)).toEqual(
        expect.not.arrayContaining(['ARR-1']),
      );
      expect(reporte.conDiferencias).toBe(4);
    });
  });

  describe('resolver', () => {
    it('Usar stock en un producto sin existencias usa la ubicación por defecto (texto) y crea la fila con ObjectId', async () => {
      const e = datosAntiguos();

      await e.conciliacion.resolver(
        e.dto(e.frijol, EstrategiaConciliacion.STOCK_PRODUCTO),
        'admin',
      );

      const [fila] = e.filas(e.frijol);

      expect(fila.cantidad).toBe(4);
      expect(texto(fila.contenedor)).toBe(texto(e.C1));
      expect(e.todoObjectId(e.frijol)).toBe(true);
      expect(e.stock(e.frijol)).toBe(4);
    });

    it('Contar acepta contenedores cuyo almacén está guardado como texto', async () => {
      const e = datosAntiguos();

      await e.conciliacion.resolver(
        e.dto(e.leche, EstrategiaConciliacion.CONTEO, [
          { almacen: e.A2, contenedor: e.C3, cantidad: 3 },
        ]),
        'admin',
      );

      expect(e.suma(e.leche)).toBe(3);
      expect(e.stock(e.leche)).toBe(3);
      expect(e.todoObjectId(e.leche)).toBe(true);
    });

    it('Contar rechaza un contenedor que de verdad no pertenece al almacén', async () => {
      const e = datosAntiguos();

      await expect(
        e.conciliacion.resolver(
          e.dto(e.leche, EstrategiaConciliacion.CONTEO, [
            { almacen: e.A1, contenedor: e.C3, cantidad: 3 },
          ]),
          'admin',
        ),
      ).rejects.toThrow('no pertenece al almacén');
      expect(e.filas(e.leche)).toHaveLength(0);
    });

    it('Contar sobre un producto con la fila de texto la actualiza sin duplicarla', async () => {
      const e = datosAntiguos();

      await e.conciliacion.resolver(
        e.dto(e.arroz, EstrategiaConciliacion.CONTEO, [
          { almacen: e.A1, contenedor: e.C1, cantidad: 6 },
        ]),
        'admin',
      );

      expect(e.filas(e.arroz)).toHaveLength(1);
      expect(e.suma(e.arroz)).toBe(6);
      expect(e.stock(e.arroz)).toBe(6);
      expect(e.todoObjectId(e.arroz)).toBe(true);
    });

    it('Usar stock con una ubicación repetida (texto + ObjectId): las junta y ajusta la única fila', async () => {
      const e = datosAntiguos();

      await e.conciliacion.resolver(
        e.dto(e.harina, EstrategiaConciliacion.STOCK_PRODUCTO),
        'admin',
      );

      expect(e.filas(e.harina)).toHaveLength(1);
      expect(e.suma(e.harina)).toBe(10);
      expect(e.stock(e.harina)).toBe(10);
      expect(e.todoObjectId(e.harina)).toBe(true);
    });

    it('Usar ubicaciones deja el total del producto igual a la suma, también con filas de texto', async () => {
      const e = datosAntiguos();

      await e.conciliacion.resolver(
        e.dto(e.harina, EstrategiaConciliacion.EXISTENCIAS),
        'admin',
      );

      expect(e.stock(e.harina)).toBe(7);
      expect(e.filas(e.harina)).toHaveLength(1);
      expect(e.todoObjectId(e.harina)).toBe(true);
    });

    it('la evidencia describe una sola ubicación, no dos', async () => {
      const e = datosAntiguos();

      await e.conciliacion.resolver(
        e.dto(e.harina, EstrategiaConciliacion.STOCK_PRODUCTO),
        'admin',
      );

      const [registro] = (await (
        e.conciliacion as unknown as {
          conciliacionModel: FakeModel;
        }
      ).conciliacionModel.find()) as Record<string, any>[];

      expect(registro.sumaExistenciasAntes).toBe(7);
      expect(registro.sumaExistenciasDespues).toBe(10);
      expect(registro.cambios).toHaveLength(1);
      expect(registro.cambios[0]).toMatchObject({ antes: 7, despues: 10 });
    });
  });

  describe('activar', () => {
    it('deja todas las existencias con ObjectId (también las de productos que ya cuadraban) y activa', async () => {
      const e = datosAntiguos();
      const resolver = (
        id: Types.ObjectId,
        estrategia: EstrategiaConciliacion,
      ) => e.conciliacion.resolver(e.dto(id, estrategia), 'admin');

      await resolver(e.harina, EstrategiaConciliacion.STOCK_PRODUCTO);
      await resolver(e.frijol, EstrategiaConciliacion.STOCK_PRODUCTO);
      await resolver(e.azucar, EstrategiaConciliacion.EXISTENCIAS);
      await e.conciliacion.resolver(
        e.dto(e.leche, EstrategiaConciliacion.CONTEO, [
          { almacen: e.A2, contenedor: e.C3, cantidad: 3 },
        ]),
        'admin',
      );

      // Arroz ya cuadraba y nadie lo resolvió: su fila sigue con ids de texto.
      expect(e.todoObjectId(e.arroz)).toBe(false);

      const reporte = await e.conciliacion.activar('admin');

      expect(reporte.unificado).toBe(true);
      expect(reporte.conDiferencias).toBe(0);
      expect(e.todoObjectId(e.arroz)).toBe(true);
      expect(
        e.existencias.docs.every(
          (d) =>
            d.producto instanceof Types.ObjectId &&
            d.almacen instanceof Types.ObjectId &&
            d.contenedor instanceof Types.ObjectId,
        ),
      ).toBe(true);
      expect(await e.existenciaService.estaUnificado()).toBe(true);
    });

    it('con diferencias pendientes se rechaza, pero ya dejó las filas normalizadas', async () => {
      const e = datosAntiguos();

      await expect(e.conciliacion.activar('admin')).rejects.toBeInstanceOf(
        ConflictException,
      );

      expect(e.todoObjectId(e.arroz)).toBe(true);
      expect(await e.existenciaService.estaUnificado()).toBe(false);
    });

    it('ya en modo unificado devuelve el reporte sin volver a normalizar', async () => {
      const e = datosAntiguos();
      e.config.insertar({ clave: 'inventario', existenciasUnificadas: true });
      const foto = JSON.stringify(e.existencias.docs);

      const reporte = await e.conciliacion.activar('admin');

      expect(reporte.unificado).toBe(true);
      expect(JSON.stringify(e.existencias.docs)).toBe(foto);
    });
  });

  describe('después de activar', () => {
    it('una venta y su cancelación dejan cada ubicación como estaba, sin filas nuevas', async () => {
      const e = datosAntiguos();
      await e.conciliacion.resolver(
        e.dto(e.harina, EstrategiaConciliacion.STOCK_PRODUCTO),
        'admin',
      );
      await e.conciliacion.resolver(
        e.dto(e.frijol, EstrategiaConciliacion.STOCK_PRODUCTO),
        'admin',
      );
      await e.conciliacion.resolver(
        e.dto(e.azucar, EstrategiaConciliacion.EXISTENCIAS),
        'admin',
      );
      await e.conciliacion.resolver(
        e.dto(e.leche, EstrategiaConciliacion.CONTEO, [
          { almacen: e.A2, contenedor: e.C3, cantidad: 3 },
        ]),
        'admin',
      );
      await e.conciliacion.activar('admin');
      const filasAntes = e.existencias.docs.length;

      const venta = await e.existenciaService.descontarProducto({
        productoId: e.arroz,
        cantidad: 3,
      });
      await e.existenciaService.reponerProducto({
        productoId: e.arroz,
        ubicaciones: venta.ubicaciones,
      });

      expect(e.existencias.docs).toHaveLength(filasAntes);
      expect(e.suma(e.arroz)).toBe(5);
      expect(e.stock(e.arroz)).toBe(5);
    });
  });
});
