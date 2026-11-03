/**
 * Pruebas de integración de las existencias (Fase 1) contra una base
 * MongoDB REAL. Son opcionales: con `npm test` normal se omiten.
 *
 * Para correrlas, apunta a una base DE PRUEBA (su nombre debe contener
 * "test"; se borra por completo al terminar):
 *
 *   # Linux / macOS
 *   MONGO_TEST_URI=mongodb://127.0.0.1:27017/xilef_test_fase1 npx jest existencia.integration
 *
 *   # Windows (PowerShell)
 *   $env:MONGO_TEST_URI="mongodb://127.0.0.1:27017/xilef_test_fase1"; npx jest existencia.integration
 *
 * Con MongoDB de verdad también se comprueba la parte que los modelos en
 * memoria no pueden probar: que dos ventas simultáneas de la última unidad
 * nunca la vendan dos veces (actualización condicional atómica).
 * Si usas un servidor compatible que NO garantiza esa atomicidad, define
 * MONGO_TEST_SIN_ATOMICIDAD=1 para omitir solo esa prueba.
 */
import mongoose, { Connection, Model, Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { ExistenciaService } from './existencia.service';
import { ConciliacionService } from './conciliacion.service';
import { StockInsuficienteException } from './stock-insuficiente.exception';
import { Existencia, ExistenciaSchema } from './schema/existencia.schema';
import {
  ConfiguracionInventario,
  ConfiguracionInventarioSchema,
} from './schema/configuracion-inventario.schema';
import {
  ConciliacionExistencia,
  ConciliacionExistenciaSchema,
  EstrategiaConciliacion,
} from './schema/conciliacion-existencia.schema';
import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import { Almacen, AlmacenSchema } from '../almacen/schema/almacen.schema';
import {
  Contenedor,
  ContenedorSchema,
} from '../contenedor/schema/contenedor.schema';
import { Kardex, KardexSchema } from '../kardex/schema/kardex.schema';

const uri = process.env.MONGO_TEST_URI;
const describeConBase = uri ? describe : describe.skip;
const itAtomico = process.env.MONGO_TEST_SIN_ATOMICIDAD ? it.skip : it;

// Crear la conexión, los índices y los datos de cada prueba tarda más que un
// test unitario: se amplía el límite de 5 s que trae jest por defecto.
jest.setTimeout(60_000);

describeConBase('Existencias contra MongoDB real (Fase 1)', () => {
  let conexion: Connection;
  let existenciaModel: Model<Existencia>;
  let productoModel: Model<Producto>;
  let almacenModel: Model<Almacen>;
  let contenedorModel: Model<Contenedor>;
  let kardexModel: Model<Kardex>;
  let configModel: Model<ConfiguracionInventario>;
  let conciliacionModel: Model<ConciliacionExistencia>;
  let servicio: ExistenciaService;
  let conciliacion: ConciliacionService;

  const todosLosModelos = (): Model<any>[] => [
    existenciaModel,
    productoModel,
    almacenModel,
    contenedorModel,
    kardexModel,
    configModel,
    conciliacionModel,
  ];

  let A1: Types.ObjectId;
  let A2: Types.ObjectId;
  let C1: Types.ObjectId;
  let C2: Types.ObjectId;
  let C3: Types.ObjectId;

  beforeAll(async () => {
    const nombreBase = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/.exec(
      uri ?? '',
    )?.[1];

    if (!nombreBase || !/test/i.test(nombreBase)) {
      throw new Error(
        'MONGO_TEST_URI debe incluir el nombre de una base cuyo nombre contenga "test" (se borra al terminar)',
      );
    }

    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    conexion = await mongoose.createConnection(uri as string).asPromise();
    existenciaModel = conexion.model(Existencia.name, ExistenciaSchema);
    productoModel = conexion.model(Producto.name, ProductoSchema);
    almacenModel = conexion.model(Almacen.name, AlmacenSchema);
    contenedorModel = conexion.model(Contenedor.name, ContenedorSchema);
    kardexModel = conexion.model(Kardex.name, KardexSchema);
    configModel = conexion.model(
      ConfiguracionInventario.name,
      ConfiguracionInventarioSchema,
    );
    conciliacionModel = conexion.model(
      ConciliacionExistencia.name,
      ConciliacionExistenciaSchema,
    );

    // Los índices únicos son parte de lo que se prueba.
    await Promise.all(todosLosModelos().map((modelo) => modelo.syncIndexes()));

    servicio = new ExistenciaService(
      existenciaModel,
      productoModel,
      almacenModel,
      contenedorModel,
      configModel,
    );
    conciliacion = new ConciliacionService(
      existenciaModel,
      productoModel,
      almacenModel,
      contenedorModel,
      kardexModel,
      conciliacionModel,
      servicio,
    );
  });

  afterAll(async () => {
    if (conexion) {
      await conexion.dropDatabase();
      await conexion.close();
    }
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await Promise.all(todosLosModelos().map((modelo) => modelo.deleteMany({})));

    const central = await almacenModel.create({
      nombreAlmacen: 'Central',
      cantidadContenedores: 2,
      codigoAlmacen: 'CEN',
    });
    const tienda = await almacenModel.create({
      nombreAlmacen: 'Tienda',
      cantidadContenedores: 1,
      codigoAlmacen: 'TIE',
    });
    A1 = central._id;
    A2 = tienda._id;
    C1 = (
      await contenedorModel.create({
        codigoContenedor: 'E1',
        nombreContenedor: 'Estante 1',
        almacen: A1,
      })
    )._id;
    C2 = (
      await contenedorModel.create({
        codigoContenedor: 'E2',
        nombreContenedor: 'Estante 2',
        almacen: A1,
      })
    )._id;
    C3 = (
      await contenedorModel.create({
        codigoContenedor: 'V1',
        nombreContenedor: 'Vitrina',
        almacen: A2,
      })
    )._id;
  });

  /** Producto "Arroz" con ubicación por defecto Central / Estante 1. */
  async function crearProducto(
    codigo: string,
    stock: number,
    existencias: [Types.ObjectId, Types.ObjectId, number][] = [],
    conDefecto = true,
  ): Promise<Types.ObjectId> {
    const producto = await productoModel.create({
      codigo_producto: codigo,
      nombre_producto: `Producto ${codigo}`,
      categoria_producto: 'General',
      precio_compra: 1,
      precio_venta: 2,
      stock_inicial: stock,
      stock_minimo: 0,
      estado: 'activo',
      ...(conDefecto ? { almacen: A1, contenedor: C1 } : {}),
    });

    for (const [almacen, contenedor, cantidad] of existencias) {
      await existenciaModel.create({
        producto: producto._id,
        almacen,
        contenedor,
        cantidad,
      });
    }

    return producto._id;
  }

  const cantidadEn = async (
    producto: Types.ObjectId,
    contenedor: Types.ObjectId,
  ): Promise<number | undefined> =>
    (await existenciaModel.findOne({ producto, contenedor }).lean())?.cantidad;

  const stockDe = async (producto: Types.ObjectId): Promise<number> =>
    (await productoModel.findById(producto).lean())!.stock_inicial;

  const sumaDe = async (producto: Types.ObjectId): Promise<number> =>
    (await existenciaModel.find({ producto }).lean()).reduce(
      (s, e) => s + e.cantidad,
      0,
    );

  // ─── Descontar / reponer ───────────────────────────────────────────
  it('descuenta repartiendo entre ubicaciones y mantiene el total sincronizado', async () => {
    const P = await crearProducto('ARR', 10, [
      [A1, C1, 6],
      [A1, C2, 3],
      [A2, C3, 1],
    ]);

    const r = await servicio.descontarProducto({ productoId: P, cantidad: 8 });

    expect(r.stockTotal).toBe(2);
    expect(await cantidadEn(P, C1)).toBe(0);
    expect(await cantidadEn(P, C2)).toBe(1);
    expect(await cantidadEn(P, C3)).toBe(1);
    expect(await stockDe(P)).toBe(2);
  });

  it('rechaza sin tocar nada cuando no alcanza', async () => {
    const P = await crearProducto('ARR', 10, [
      [A1, C1, 6],
      [A1, C2, 4],
    ]);

    await expect(
      servicio.descontarProducto({ productoId: P, cantidad: 11 }),
    ).rejects.toBeInstanceOf(StockInsuficienteException);

    expect(await sumaDe(P)).toBe(10);
    expect(await stockDe(P)).toBe(10);
  });

  it('repone en las ubicaciones exactas y crea las filas que faltan', async () => {
    const P = await crearProducto('ARR', 6, [[A1, C1, 6]]);

    await servicio.reponerProducto({
      productoId: P,
      ubicaciones: [
        { almacen: A1, contenedor: C1, cantidad: 1 },
        { almacen: A1, contenedor: C2, cantidad: 2 },
      ],
    });

    expect(await cantidadEn(P, C1)).toBe(7);
    expect(await cantidadEn(P, C2)).toBe(2);
    expect(await stockDe(P)).toBe(9);
  });

  it('descontar y reponer lo devuelto deja el saldo como estaba', async () => {
    const P = await crearProducto('ARR', 10, [
      [A1, C1, 6],
      [A1, C2, 3],
      [A2, C3, 1],
    ]);

    const salida = await servicio.descontarProducto({
      productoId: P,
      cantidad: 9,
    });
    await servicio.reponerProducto({
      productoId: P,
      ubicaciones: salida.ubicaciones,
    });

    expect(await cantidadEn(P, C1)).toBe(6);
    expect(await cantidadEn(P, C2)).toBe(3);
    expect(await cantidadEn(P, C3)).toBe(1);
    expect(await stockDe(P)).toBe(10);
  });

  it('vende el saldo completo de una fracción con residuo binario', async () => {
    const P = await crearProducto('FRA', 0.7, [[A1, C1, 0.7]]);

    await servicio.descontarProducto({ productoId: P, cantidad: 0.4 });
    const r = await servicio.descontarProducto({
      productoId: P,
      cantidad: 0.3,
    });

    expect(r.stockTotal).toBe(0);
    expect(Math.abs((await cantidadEn(P, C1)) as number)).toBeLessThan(1e-6);
  });

  it('el índice único impide dos filas para la misma ubicación', async () => {
    const P = await crearProducto('ARR', 5, [[A1, C1, 5]]);

    await expect(
      existenciaModel.create({
        producto: P,
        almacen: A1,
        contenedor: C1,
        cantidad: 1,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('sumarExistencias (aggregate) suma las filas del producto indicado', async () => {
    const P = await crearProducto('ARR', 9, [
      [A1, C1, 6],
      [A1, C2, 3],
    ]);
    await crearProducto('OTRO', 4, [[A2, C3, 4]]);

    expect(await servicio.sumarExistencias(P)).toBe(9);
  });

  it('fijarCantidad devuelve la cantidad anterior y crea la fila si falta', async () => {
    const P = await crearProducto('ARR', 6, [[A1, C1, 6]]);

    expect(await servicio.fijarCantidad(P, A1, C1, 2)).toBe(6);
    expect(await servicio.fijarCantidad(P, A1, C2, 5)).toBe(0);
    expect(await cantidadEn(P, C1)).toBe(2);
    expect(await cantidadEn(P, C2)).toBe(5);
  });

  it('la compuerta se activa y se lee igual que en producción', async () => {
    expect(await servicio.estaUnificado()).toBe(false);

    await servicio.activarModoUnificado('admin');
    await servicio.activarModoUnificado('admin');

    expect(await servicio.estaUnificado()).toBe(true);
    expect(await configModel.countDocuments({})).toBe(1);
  });

  // ─── Concurrencia (necesita MongoDB real) ──────────────────────────
  itAtomico(
    'diez ventas simultáneas de 1 unidad con 5 en stock: se venden exactamente 5',
    async () => {
      const P = await crearProducto('ARR', 5, [[A1, C1, 5]]);

      const resultados = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          servicio.descontarProducto({ productoId: P, cantidad: 1 }),
        ),
      );

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
        5,
      );
      for (const r of resultados) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(StockInsuficienteException);
        }
      }
      expect(await cantidadEn(P, C1)).toBe(0);
      expect(await stockDe(P)).toBe(0);
    },
  );

  itAtomico(
    'dos cajeros que venden la última unidad a la vez: solo uno la vende',
    async () => {
      const P = await crearProducto('ARR', 1, [[A1, C1, 1]]);

      const resultados = await Promise.allSettled([
        servicio.descontarProducto({ productoId: P, cantidad: 1 }),
        servicio.descontarProducto({ productoId: P, cantidad: 1 }),
      ]);

      expect(resultados.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await cantidadEn(P, C1)).toBe(0);
      expect(await stockDe(P)).toBe(0);
    },
  );

  itAtomico(
    'con varias ubicaciones nunca se vende de más ni se pierden unidades',
    async () => {
      const P = await crearProducto('ARR', 6, [
        [A1, C1, 3],
        [A1, C2, 3],
      ]);

      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          servicio.descontarProducto({ productoId: P, cantidad: 2 }),
        ),
      );
      const vendidas =
        resultados.filter((r) => r.status === 'fulfilled').length * 2;

      expect(vendidas).toBeLessThanOrEqual(6);
      expect(await cantidadEn(P, C1)).toBeGreaterThanOrEqual(0);
      expect(await cantidadEn(P, C2)).toBeGreaterThanOrEqual(0);
      expect((await sumaDe(P)) + vendidas).toBe(6);
      expect(await stockDe(P)).toBe(await sumaDe(P));
    },
  );

  // ─── Conciliación de punta a punta ─────────────────────────────────
  it('reporte → resolver → activar, con evidencia y Kardex válidos para sus esquemas', async () => {
    const concilia = await crearProducto('OK', 5, [[A1, C1, 5]]);
    const azucar = await crearProducto('AZU', 10, [
      [A1, C1, 5],
      [A1, C2, 2],
    ]);
    const frijol = await crearProducto('FRI', 4);

    const reporte = await conciliacion.obtenerReporte();
    expect(reporte.totalProductos).toBe(3);
    expect(reporte.filas.map((f) => f.codigo)).toEqual(['AZU', 'FRI']);
    expect(reporte.filas[1].estado).toBe('sin_ubicacion');
    expect(reporte.filas[1].ubicacionPorDefecto?.almacenNombre).toBe('Central');

    await expect(conciliacion.activar('admin')).rejects.toThrow('quedan 2');

    await conciliacion.resolver(
      {
        productoId: String(azucar),
        estrategia: EstrategiaConciliacion.CONTEO,
        ubicaciones: [
          {
            almacenId: String(A1),
            contenedorId: String(C1),
            cantidad: 4,
          },
        ],
        observacion: 'Conteo del lunes',
      },
      'ana',
    );
    await conciliacion.resolver(
      {
        productoId: String(frijol),
        estrategia: EstrategiaConciliacion.STOCK_PRODUCTO,
      },
      'ana',
    );

    // Azúcar: 4 + 2 = 6 (antes 10) → Kardex SALIDA de 4.
    expect(await stockDe(azucar)).toBe(6);
    expect(await cantidadEn(frijol, C1)).toBe(4);
    const kardex = await kardexModel.find({ productoId: azucar }).lean();
    expect(kardex).toHaveLength(1);
    expect(kardex[0]).toMatchObject({ tipo: 'salida', cantidad: 4, stock: 6 });
    const evidencias = await conciliacionModel
      .find({ producto: azucar })
      .lean();
    expect(evidencias).toHaveLength(1);
    expect(evidencias[0]).toMatchObject({
      estrategia: 'conteo',
      usuario: 'ana',
      observacion: 'Conteo del lunes',
      stockProductoAntes: 10,
      stockProductoDespues: 6,
    });
    expect(String(kardex[0].referencia)).toBe(String(evidencias[0]._id));

    const activado = await conciliacion.activar('admin');
    expect(activado.unificado).toBe(true);
    expect(activado.conDiferencias).toBe(0);
    expect(await servicio.estaUnificado()).toBe(true);
    expect(await stockDe(concilia)).toBe(5);
  });

  // ─── Datos antiguos: ids guardados como texto ──────────────────────
  //
  // La base real guarda `contenedores.almacen` y `productos.almacen /
  // contenedor` con el texto que mandó el formulario (esquemas `Mixed`), y
  // las existencias que creaba `sincronizarUbicacionInicial` también. MongoDB
  // distingue el texto del ObjectId (también en el índice único); algunos
  // servidores compatibles no.
  describe('con ids guardados como texto (datos antiguos)', () => {
    /** Los catálogos como los deja el formulario: ids de texto. */
    async function catalogosComoTexto(): Promise<void> {
      for (const contenedor of await contenedorModel.find().lean()) {
        // `almacen` es `Mixed`: Mongoose guarda el texto tal cual.
        await contenedorModel.updateOne(
          { _id: contenedor._id },
          { $set: { almacen: String(contenedor.almacen) } },
        );
      }
    }

    async function crearProductoAntiguo(
      codigo: string,
      stock: number,
    ): Promise<Types.ObjectId> {
      const producto = await productoModel.create({
        codigo_producto: codigo,
        nombre_producto: `Producto ${codigo}`,
        categoria_producto: 'General',
        precio_compra: 1,
        precio_venta: 2,
        stock_inicial: stock,
        stock_minimo: 0,
        estado: 'activo',
        almacen: String(A1),
        contenedor: String(C1),
      });

      return producto._id;
    }

    /** Filas tal como están guardadas (sin que Mongoose las convierta). */
    const filasCrudas = (producto: Types.ObjectId) =>
      existenciaModel.collection.find({ producto }).toArray();

    const todoObjectId = async (producto: Types.ObjectId): Promise<boolean> =>
      (await filasCrudas(producto)).every(
        (f) =>
          f.producto instanceof Types.ObjectId &&
          f.almacen instanceof Types.ObjectId &&
          f.contenedor instanceof Types.ObjectId,
      );

    /** Fila con ids de texto, como las de `sincronizarUbicacionInicial`. */
    const filaAntigua = (
      producto: Types.ObjectId,
      contenedor: Types.ObjectId,
      cantidad: number,
    ) =>
      existenciaModel.collection.insertOne({
        producto,
        almacen: String(A1),
        contenedor: String(contenedor),
        cantidad,
      });

    beforeEach(catalogosComoTexto);

    it('"Contar" funciona aunque el almacén del contenedor esté guardado como texto', async () => {
      const P = await crearProductoAntiguo('LEC', 3);

      await conciliacion.resolver(
        {
          productoId: String(P),
          estrategia: EstrategiaConciliacion.CONTEO,
          ubicaciones: [
            { almacenId: String(A2), contenedorId: String(C3), cantidad: 3 },
          ],
        },
        'ana',
      );

      expect(await sumaDe(P)).toBe(3);
      expect(await todoObjectId(P)).toBe(true);
      await expect(
        conciliacion.resolver(
          {
            productoId: String(P),
            estrategia: EstrategiaConciliacion.CONTEO,
            ubicaciones: [
              { almacenId: String(A1), contenedorId: String(C3), cantidad: 3 },
            ],
          },
          'ana',
        ),
      ).rejects.toThrow('no pertenece al almacén');
    });

    it('"Usar stock" sin existencias usa la ubicación del producto (texto) y crea la fila con ObjectId', async () => {
      const P = await crearProductoAntiguo('FRI', 4);

      await conciliacion.resolver(
        {
          productoId: String(P),
          estrategia: EstrategiaConciliacion.STOCK_PRODUCTO,
        },
        'ana',
      );

      expect(await cantidadEn(P, C1)).toBe(4);
      expect(await todoObjectId(P)).toBe(true);
    });

    it('la fila con ids de texto se convierte y se actualiza en sitio, sin duplicarse', async () => {
      const P = await crearProductoAntiguo('ARR', 5);
      await filaAntigua(P, C1, 5);

      await conciliacion.resolver(
        {
          productoId: String(P),
          estrategia: EstrategiaConciliacion.CONTEO,
          ubicaciones: [
            { almacenId: String(A1), contenedorId: String(C1), cantidad: 6 },
          ],
        },
        'ana',
      );

      expect(await filasCrudas(P)).toHaveLength(1);
      expect(await sumaDe(P)).toBe(6);
      expect(await stockDe(P)).toBe(6);
      expect(await todoObjectId(P)).toBe(true);
    });

    it('una ubicación repetida (texto + ObjectId) se suma en una sola fila', async () => {
      const P = await crearProductoAntiguo('HAR', 10);
      await existenciaModel.create({
        producto: P,
        almacen: A1,
        contenedor: C1,
        cantidad: 3,
      });

      try {
        await filaAntigua(P, C1, 4);
      } catch (error) {
        // Un servidor que trata el texto y el ObjectId como la misma clave
        // (p. ej. FerretDB) no admite esta situación: en MongoDB sí ocurre.
        expect((error as { code?: number }).code).toBe(11000);
        return;
      }

      const reporte = await conciliacion.obtenerReporte();
      const fila = reporte.filas.find((f) => f.codigo === 'HAR');
      expect(fila?.ubicaciones).toHaveLength(1);
      expect(fila?.ubicaciones[0].cantidad).toBe(7);

      await conciliacion.resolver(
        {
          productoId: String(P),
          estrategia: EstrategiaConciliacion.STOCK_PRODUCTO,
        },
        'ana',
      );

      expect(await filasCrudas(P)).toHaveLength(1);
      expect(await sumaDe(P)).toBe(10);
      expect(await todoObjectId(P)).toBe(true);
    });

    it('activar deja todas las existencias con ObjectId, también las de productos que ya cuadraban', async () => {
      const P = await crearProductoAntiguo('ARR', 5);
      await filaAntigua(P, C1, 5);
      expect(await todoObjectId(P)).toBe(false);

      const reporte = await conciliacion.activar('admin');

      expect(reporte.unificado).toBe(true);
      expect(await todoObjectId(P)).toBe(true);
      expect(await filasCrudas(P)).toHaveLength(1);
    });

    it('en modo unificado, reponer sin ubicación suma sobre la fila existente y no abre otra', async () => {
      const P = await crearProductoAntiguo('ARR', 5);
      await filaAntigua(P, C1, 5);
      await conciliacion.activar('admin');

      await servicio.reponerProducto({ productoId: P, cantidad: 2 });
      const venta = await servicio.descontarProducto({
        productoId: P,
        cantidad: 3,
      });
      await servicio.reponerProducto({
        productoId: P,
        ubicaciones: venta.ubicaciones,
      });

      expect(await filasCrudas(P)).toHaveLength(1);
      expect(await cantidadEn(P, C1)).toBe(7);
      expect(await stockDe(P)).toBe(7);
    });

    itAtomico(
      'dos reposiciones simultáneas a una ubicación nueva suman las dos y dejan una sola fila',
      async () => {
        const P = await crearProductoAntiguo('FRI', 0);

        await Promise.all([
          servicio.reponerProducto({ productoId: P, cantidad: 1 }),
          servicio.reponerProducto({ productoId: P, cantidad: 2 }),
        ]);

        expect(await filasCrudas(P)).toHaveLength(1);
        expect(await sumaDe(P)).toBe(3);
        expect(await stockDe(P)).toBe(3);
      },
    );
  });
});
