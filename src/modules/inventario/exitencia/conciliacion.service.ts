import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Existencia } from './schema/existencia.schema';
import {
  ConciliacionExistencia,
  EstrategiaConciliacion,
} from './schema/conciliacion-existencia.schema';
import { ExistenciaService } from './existencia.service';
import { ResolverConciliacionDto } from './dto/resolver-conciliacion.dto';
import { EPSILON, aObjectId, ambosTipos, redondear } from './existencia.types';
import { Producto } from '../producto/schemas/producto.schema';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';

export type EstadoConciliacion = 'conciliado' | 'difiere' | 'sin_ubicacion';

export interface UbicacionConciliacion {
  almacenId: string;
  almacenNombre: string;
  contenedorId: string;
  contenedorNombre: string;
  cantidad: number;
}

export interface FilaConciliacion {
  productoId: string;
  codigo: string;
  nombre: string;
  /** `Producto.stock_inicial`: lo que han ido moviendo ventas, facturas y ajustes. */
  stockProducto: number;
  /** Σ de `Existencia.cantidad` del producto. */
  sumaExistencias: number;
  /** stockProducto − sumaExistencias. */
  diferencia: number;
  estado: EstadoConciliacion;
  ubicaciones: UbicacionConciliacion[];
  /** Ubicación por defecto del producto, si es válida (sugerencia al resolver). */
  ubicacionPorDefecto?: Omit<UbicacionConciliacion, 'cantidad'>;
}

export interface ReporteConciliacion {
  unificado: boolean;
  unificadoEn?: Date;
  unificadoPor?: string;
  totalProductos: number;
  conciliados: number;
  conDiferencias: number;
  /** Solo los productos que NO concilian. */
  filas: FilaConciliacion[];
}

interface FilaExistenciaLean {
  _id: Types.ObjectId;
  almacen: Types.ObjectId;
  contenedor: Types.ObjectId;
  cantidad: number;
}

const igual = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON;
const numero = (valor: unknown): number => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Conciliación de existencias (Fase 1).
 *
 * Antes de que la venta y la factura pasen a descontar `Existencia`, el
 * saldo de cada producto (`stock_inicial`, que hasta hoy movían ventas,
 * facturas y ajustes) debe coincidir con la suma de sus existencias por
 * ubicación (que solo movían las transferencias). Este servicio:
 *
 *  1. `obtenerReporte`: lista los productos que no concilian.
 *  2. `resolver`: el administrador decide cuál es el saldo correcto de un
 *     producto (o cuenta físicamente por ubicación). Cada decisión queda
 *     registrada (quién, antes/después) y, si cambia el total del
 *     producto, en el Kardex. Nada cambia en silencio.
 *  3. `activar`: solo con 0 diferencias, activa el modo unificado.
 */
@Injectable()
export class ConciliacionService {
  private readonly logger = new Logger(ConciliacionService.name);

  constructor(
    @InjectModel(Existencia.name)
    private readonly existenciaModel: Model<Existencia>,
    @InjectModel(Producto.name)
    private readonly productoModel: Model<Producto>,
    @InjectModel(Almacen.name)
    private readonly almacenModel: Model<Almacen>,
    @InjectModel(Contenedor.name)
    private readonly contenedorModel: Model<Contenedor>,
    @InjectModel(Kardex.name)
    private readonly kardexModel: Model<Kardex>,
    @InjectModel(ConciliacionExistencia.name)
    private readonly conciliacionModel: Model<ConciliacionExistencia>,
    private readonly existenciaService: ExistenciaService,
  ) {}

  // ─── 1. Reporte ────────────────────────────────────────────────

  async obtenerReporte(): Promise<ReporteConciliacion> {
    const [estado, productos, grupos, almacenes, contenedores] =
      await Promise.all([
        this.existenciaService.obtenerEstadoUnificacion(),
        this.productoModel
          .find()
          .select(
            'codigo_producto nombre_producto stock_inicial almacen contenedor',
          )
          .sort({ codigo_producto: 1 })
          .lean()
          .exec(),
        this.existenciaModel
          .find()
          .select('producto almacen contenedor cantidad')
          .lean()
          .exec(),
        this.almacenModel.find().select('nombreAlmacen').lean().exec(),
        this.contenedorModel
          .find()
          .select('nombreContenedor almacen')
          .lean()
          .exec(),
      ]);

    const nombreAlmacen = new Map(
      almacenes.map((a) => [String(a._id), a.nombreAlmacen]),
    );
    const contenedorPorId = new Map(
      contenedores.map((c) => [String(c._id), c]),
    );
    const filasPorProducto = new Map<string, FilaExistenciaLean[]>();

    for (const fila of grupos) {
      const clave = String(fila.producto);
      const lista = filasPorProducto.get(clave) ?? [];
      lista.push(fila);
      filasPorProducto.set(clave, lista);
    }

    const describir = (
      almacen: Types.ObjectId,
      contenedor: Types.ObjectId,
    ): Omit<UbicacionConciliacion, 'cantidad'> => ({
      almacenId: String(almacen),
      almacenNombre:
        nombreAlmacen.get(String(almacen)) ?? '(almacén eliminado)',
      contenedorId: String(contenedor),
      contenedorNombre:
        contenedorPorId.get(String(contenedor))?.nombreContenedor ??
        '(contenedor eliminado)',
    });

    const filas: FilaConciliacion[] = [];

    for (const producto of productos) {
      const id = String(producto._id);
      // Una ubicación puede tener dos filas si una quedó con ids de texto
      // (datos antiguos): para quien concilia es una sola ubicación. El
      // reporte no escribe nada; `resolver` y `activar` las unen en la base.
      const existencias = this.unirPorUbicacion(filasPorProducto.get(id) ?? []);
      const stockProducto = redondear(numero(producto.stock_inicial));
      const sumaExistencias = redondear(
        existencias.reduce((suma, e) => suma + numero(e.cantidad), 0),
      );

      if (igual(stockProducto, sumaExistencias)) {
        continue;
      }

      const porDefecto =
        producto.almacen &&
        producto.contenedor &&
        String(
          contenedorPorId.get(String(producto.contenedor))?.almacen ?? '',
        ) === String(producto.almacen)
          ? describir(producto.almacen, producto.contenedor)
          : undefined;

      filas.push({
        productoId: id,
        codigo: producto.codigo_producto,
        nombre: producto.nombre_producto,
        stockProducto,
        sumaExistencias,
        diferencia: redondear(stockProducto - sumaExistencias),
        estado:
          existencias.length === 0 && stockProducto > EPSILON
            ? 'sin_ubicacion'
            : 'difiere',
        ubicaciones: existencias.map((e) => ({
          ...describir(e.almacen, e.contenedor),
          cantidad: redondear(numero(e.cantidad)),
        })),
        ubicacionPorDefecto: porDefecto,
      });
    }

    return {
      ...estado,
      totalProductos: productos.length,
      conciliados: productos.length - filas.length,
      conDiferencias: filas.length,
      filas,
    };
  }

  /** Suma las filas que son la misma ubicación física (mismo almacén y contenedor). */
  private unirPorUbicacion(filas: FilaExistenciaLean[]): FilaExistenciaLean[] {
    const mapa = new Map<string, FilaExistenciaLean>();

    for (const fila of filas) {
      const clave = `${String(fila.almacen)}|${String(fila.contenedor)}`;
      const actual = mapa.get(clave);

      mapa.set(
        clave,
        actual
          ? {
              ...actual,
              cantidad: redondear(
                numero(actual.cantidad) + numero(fila.cantidad),
              ),
            }
          : { ...fila, cantidad: numero(fila.cantidad) },
      );
    }

    return [...mapa.values()];
  }

  // ─── 2. Resolución ─────────────────────────────────────────────

  async resolver(
    dto: ResolverConciliacionDto,
    usuario: string,
  ): Promise<FilaConciliacion | { productoId: string; estado: 'conciliado' }> {
    const productoId = new Types.ObjectId(dto.productoId);
    const producto = await this.productoModel
      .findById(productoId)
      .select('nombre_producto stock_inicial almacen contenedor')
      .lean()
      .exec();

    if (!producto) {
      throw new NotFoundException('El producto no existe');
    }

    // Datos antiguos: deja una sola fila por ubicación, con ids ObjectId, antes
    // de leer los saldos de "antes" y de escribir los nuevos.
    await this.existenciaService.normalizarExistencias(productoId);

    const antes = (await this.leerFilas(productoId)).map((f) => ({
      ...f,
    }));
    const stockAntes = redondear(numero(producto.stock_inicial));
    const sumaAntes = redondear(
      antes.reduce((suma, f) => suma + numero(f.cantidad), 0),
    );

    switch (dto.estrategia) {
      case EstrategiaConciliacion.STOCK_PRODUCTO:
        await this.usarStockDelProducto(
          productoId,
          producto,
          antes,
          stockAntes,
          dto,
        );
        break;
      case EstrategiaConciliacion.EXISTENCIAS:
        // Las existencias mandan: solo cambia el total del producto.
        await this.existenciaService.fijarStockProducto(productoId, sumaAntes);
        break;
      case EstrategiaConciliacion.CONTEO:
        await this.aplicarConteo(productoId, dto);
        break;
    }

    const despues = await this.leerFilas(productoId);
    const sumaDespues = redondear(
      despues.reduce((suma, f) => suma + numero(f.cantidad), 0),
    );

    if (dto.estrategia === EstrategiaConciliacion.CONTEO) {
      await this.existenciaService.fijarStockProducto(productoId, sumaDespues);
    }

    const productoDespues = await this.productoModel
      .findById(productoId)
      .select('stock_inicial')
      .lean()
      .exec();
    const stockDespues = redondear(numero(productoDespues?.stock_inicial));

    if (!igual(stockDespues, sumaDespues)) {
      // Otro movimiento tocó el producto mientras se conciliaba.
      throw new ConflictException(
        'El producto cambió mientras se conciliaba (venta o ajuste simultáneo); revise y vuelva a intentar',
      );
    }

    await this.registrar({
      productoId,
      dto,
      usuario,
      antes,
      despues,
      stockAntes,
      stockDespues,
      sumaAntes,
      sumaDespues,
    });

    return { productoId: dto.productoId, estado: 'conciliado' };
  }

  /** El stock del producto es el correcto: las existencias se ajustan a él. */
  private async usarStockDelProducto(
    productoId: Types.ObjectId,
    producto: {
      almacen?: Types.ObjectId | string;
      contenedor?: Types.ObjectId | string;
    },
    filas: FilaExistenciaLean[],
    stock: number,
    dto: ResolverConciliacionDto,
  ): Promise<void> {
    if (stock < -EPSILON) {
      throw new BadRequestException(
        'El stock del producto es negativo: use las existencias o un conteo físico',
      );
    }

    if (filas.length > 1) {
      throw new BadRequestException(
        'El producto tiene varias ubicaciones: indique la cantidad real de cada una con el conteo físico',
      );
    }

    if (filas.length === 1) {
      const almacenFila = aObjectId(filas[0].almacen);
      const contenedorFila = aObjectId(filas[0].contenedor);

      if (!almacenFila || !contenedorFila) {
        throw new BadRequestException(
          'La existencia tiene un almacén o un contenedor no válido: use el conteo físico',
        );
      }

      await this.existenciaService.fijarCantidad(
        productoId,
        almacenFila,
        contenedorFila,
        stock,
      );
      return;
    }

    if (stock <= EPSILON) {
      return; // Sin existencias y sin stock: ya concilia.
    }

    // Sin existencias pero con stock: hay que decir dónde está.
    // La ubicación del producto está guardada como texto (formulario) u
    // ObjectId; la fila de existencias se crea siempre con ObjectId.
    const elegida = dto.ubicaciones?.[0];
    const almacen = elegida
      ? new Types.ObjectId(elegida.almacenId)
      : aObjectId(producto.almacen);
    const contenedor = elegida
      ? new Types.ObjectId(elegida.contenedorId)
      : aObjectId(producto.contenedor);

    if (!almacen || !contenedor) {
      throw new BadRequestException(
        'El producto no tiene ubicación: indique el almacén y el contenedor donde está',
      );
    }

    await this.validarUbicacion(almacen, contenedor);
    await this.existenciaService.fijarCantidad(
      productoId,
      almacen,
      contenedor,
      stock,
    );
  }

  /** Conteo físico: cada ubicación indicada queda con la cantidad contada. */
  private async aplicarConteo(
    productoId: Types.ObjectId,
    dto: ResolverConciliacionDto,
  ): Promise<void> {
    const ubicaciones = dto.ubicaciones ?? [];

    if (ubicaciones.length === 0) {
      throw new BadRequestException(
        'El conteo físico necesita al menos una ubicación con su cantidad',
      );
    }

    const vistas = new Set<string>();

    for (const u of ubicaciones) {
      const clave = `${u.almacenId}|${u.contenedorId}`;

      if (vistas.has(clave)) {
        throw new BadRequestException(
          'Una ubicación aparece repetida en el conteo',
        );
      }

      vistas.add(clave);
      await this.validarUbicacion(
        new Types.ObjectId(u.almacenId),
        new Types.ObjectId(u.contenedorId),
      );
    }

    for (const u of ubicaciones) {
      await this.existenciaService.fijarCantidad(
        productoId,
        new Types.ObjectId(u.almacenId),
        new Types.ObjectId(u.contenedorId),
        u.cantidad,
      );
    }
  }

  private async validarUbicacion(
    almacen: Types.ObjectId,
    contenedor: Types.ObjectId,
  ): Promise<void> {
    // `contenedores.almacen` se guardó con el texto del formulario: se acepta
    // tanto texto como ObjectId (ver `aObjectId`).
    const valida = await this.contenedorModel.exists({
      _id: contenedor,
      almacen: { $in: ambosTipos(almacen) },
    });

    if (!valida) {
      throw new BadRequestException(
        'El contenedor no existe o no pertenece al almacén indicado',
      );
    }
  }

  private leerFilas(productoId: Types.ObjectId): Promise<FilaExistenciaLean[]> {
    return this.existenciaModel
      .find({ producto: { $in: ambosTipos(productoId) } })
      .select('almacen contenedor cantidad')
      .lean()
      .exec();
  }

  /** Evidencia de la resolución y, si el total del producto cambió, su Kardex. */
  private async registrar(datos: {
    productoId: Types.ObjectId;
    dto: ResolverConciliacionDto;
    usuario: string;
    antes: FilaExistenciaLean[];
    despues: FilaExistenciaLean[];
    stockAntes: number;
    stockDespues: number;
    sumaAntes: number;
    sumaDespues: number;
  }): Promise<void> {
    const cantidadAntes = new Map(
      datos.antes.map((f) => [
        `${String(f.almacen)}|${String(f.contenedor)}`,
        numero(f.cantidad),
      ]),
    );
    const cambios = datos.despues
      .map((f) => {
        const clave = `${String(f.almacen)}|${String(f.contenedor)}`;
        return {
          almacen: f.almacen,
          contenedor: f.contenedor,
          antes: redondear(cantidadAntes.get(clave) ?? 0),
          despues: redondear(numero(f.cantidad)),
        };
      })
      .filter((c) => !igual(c.antes, c.despues));

    const registro = {
      producto: datos.productoId,
      estrategia: datos.dto.estrategia,
      usuario: datos.usuario,
      observacion: datos.dto.observacion,
      stockProductoAntes: datos.stockAntes,
      stockProductoDespues: datos.stockDespues,
      sumaExistenciasAntes: datos.sumaAntes,
      sumaExistenciasDespues: datos.sumaDespues,
      cambios,
    };

    const evidencia = await this.conciliacionModel
      .create(registro)
      .catch((error: unknown) => {
        // Los saldos ya cambiaron: que al menos el log conserve la evidencia.
        this.logger.error(
          `No se pudo guardar la evidencia de la conciliación, conservar este registro: ${JSON.stringify(registro)} — ${String(error)}`,
        );
        throw error;
      });

    const delta = redondear(datos.stockDespues - datos.stockAntes);

    if (igual(delta, 0)) {
      return;
    }

    try {
      await this.kardexModel.create({
        productoId: datos.productoId,
        tipo: delta > 0 ? KardexTipo.ENTRADA : KardexTipo.SALIDA,
        cantidad: Math.abs(delta),
        stock: Math.max(0, datos.stockDespues),
        motivo: `Conciliación de existencias (${datos.usuario}): stock ${datos.stockAntes} → ${datos.stockDespues}`,
        referencia: String(evidencia._id),
      });
    } catch (error) {
      // El saldo ya cambió y la evidencia está guardada: no se deshace.
      this.logger.error(
        `No se pudo registrar el Kardex de la conciliación ${String(evidencia._id)} (producto ${String(datos.productoId)}, delta ${delta}); registrar a mano: ${String(error)}`,
      );
    }
  }

  // ─── 3. Activación ─────────────────────────────────────────────

  async activar(usuario: string): Promise<ReporteConciliacion> {
    const estado = await this.existenciaService.obtenerEstadoUnificacion();

    if (estado.unificado) {
      return this.obtenerReporte();
    }

    // A partir de aquí todas las operaciones buscan las existencias con
    // ObjectId: las filas antiguas con ids de texto se dejan así antes de activar.
    // La suma por producto no cambia, así que el reporte de abajo es el mismo.
    await this.existenciaService.normalizarExistencias();

    const reporte = await this.obtenerReporte();

    if (reporte.conDiferencias > 0) {
      throw new ConflictException(
        `No se puede activar: quedan ${reporte.conDiferencias} producto(s) con diferencias. Concílielos primero.`,
      );
    }

    await this.existenciaService.activarModoUnificado(usuario);

    return this.obtenerReporte();
  }
}
