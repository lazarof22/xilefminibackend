import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Producto } from '../inventario/producto/schemas/producto.schema';
import { Kardex, KardexTipo } from '../inventario/kardex/schema/kardex.schema';
import { Estado } from '../nomencladores/estado/schema/estado.schema';
import { mismoId, variantesHex, variantesId } from './factura-ids';

/** The part of an invoice the inventory movements need. */
export interface FacturaParaInventario {
  id: string;
  /** Written by factura as an ObjectId; a string is tolerated (T7c). */
  almacenId?: Types.ObjectId | string;
  items: { productoId: string; cantidad: number }[];
}

/** Total quantity of one product across every item of the invoice. */
export interface LineaInventario {
  productoId: string;
  cantidad: number;
}

/** Stock applied to a product (the resulting stock feeds the Kardex entry). */
interface MovimientoAplicado extends LineaInventario {
  stockResultante: number;
}

/**
 * Canonical (lowercase hex) form of a productoId, so the same product sent
 * in different case aggregates into one line. A legacy value that is not a
 * valid ObjectId is kept as is (it can never match a product).
 */
function productoIdCanonico(productoId: string): string {
  return Types.ObjectId.isValid(productoId)
    ? new Types.ObjectId(productoId).toHexString()
    : productoId;
}

/**
 * Sums the quantities per product (a productoId may repeat across items)
 * and sorts by productoId, so every confirm/cancel touches products in the
 * same deterministic order.
 */
export function agregarCantidadesPorProducto(
  items: { productoId: string; cantidad: number }[],
): LineaInventario[] {
  const cantidades = new Map<string, number>();
  for (const item of items) {
    const id = productoIdCanonico(item.productoId);
    cantidades.set(id, (cantidades.get(id) ?? 0) + item.cantidad);
  }
  return [...cantidades.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productoId, cantidad]) => ({ productoId, cantidad }));
}

/** Row-level detail a Mongoose/driver `insertMany` error may carry. */
interface ErrorInsercionKardex {
  validationErrors?: { index?: number; message?: string }[];
  writeErrors?: { index?: number; errmsg?: string }[];
}

function comoErrorInsercion(error: unknown): ErrorInsercionKardex {
  return typeof error === 'object' && error !== null ? error : {};
}

/**
 * Indexes of the Kardex rows an unordered `insertMany` did not write:
 * Mongoose validation errors and server write errors both carry the row
 * index. An error without row detail (e.g. network) means any row may be
 * missing, so every row is reported.
 */
export function filasKardexFallidas(error: unknown, total: number): number[] {
  const { validationErrors = [], writeErrors = [] } = comoErrorInsercion(error);
  const indices = new Set(
    [...validationErrors, ...writeErrors]
      .map((fallo) => fallo.index)
      .filter(
        (indice): indice is number =>
          typeof indice === 'number' && indice >= 0 && indice < total,
      ),
  );
  if (indices.size === 0) {
    return [...Array(total).keys()];
  }
  return [...indices].sort((a, b) => a - b);
}

function detalleErroresKardex(error: unknown): string {
  const { validationErrors = [], writeErrors = [] } = comoErrorInsercion(error);
  const detalles = [
    ...validationErrors.map((fallo) => `fila ${fallo.index}: ${fallo.message}`),
    ...writeErrors.map((fallo) => `fila ${fallo.index}: ${fallo.errmsg}`),
  ];
  return detalles.length > 0 ? ` (${detalles.join('; ')})` : '';
}

/**
 * Inventory side effects of the invoice lifecycle (T7): `confirmar`
 * decreases stock (Kardex `venta`), `cancelar` restores it (Kardex
 * `devolucion`). Kept out of `FacturaService`, which owns the state
 * transitions and only decides *when* these run.
 *
 * MongoDB runs standalone (no replica set), so there are no multi-document
 * transactions: every product write is a single atomic, guarded update and
 * a failure is undone by compensating writes. Stock (`Producto.stock_inicial`,
 * the same live field `VentaService` uses) is the source of truth; a Kardex
 * write that fails after stock changed is logged, never rolled back.
 */
@Injectable()
export class FacturaInventarioService {
  private readonly logger = new Logger(FacturaInventarioService.name);

  constructor(
    @InjectModel(Producto.name) private productoModel: Model<Producto>,
    @InjectModel(Kardex.name) private kardexModel: Model<Kardex>,
    @InjectModel(Estado.name) private estadoModel: Model<Estado>,
  ) {}

  /**
   * Decreases the stock of every product of the invoice. Each decrement is
   * guarded (enough stock, not inactive, same warehouse when the product
   * has one); on the first one that does not match, every decrement already
   * applied is compensated and a 409 naming the product is thrown.
   *
   * A decrement write that throws (timeout, network) is ambiguous: it may
   * or may not have been applied. That product is never compensated (a
   * blind `+cantidad` could create stock); it is logged for manual
   * reconciliation, the decrements known applied are compensated, and the
   * original error is rethrown.
   */
  async rebajarStock(factura: FacturaParaInventario): Promise<void> {
    const estadoInactivoId = await this.obtenerEstadoInactivoId();
    const aplicados: MovimientoAplicado[] = [];

    for (const linea of agregarCantidadesPorProducto(factura.items)) {
      let actualizado: Producto | null = null;
      try {
        actualizado = Types.ObjectId.isValid(linea.productoId)
          ? await this.productoModel
              .findOneAndUpdate(
                this.filtroRebaja(linea, factura, estadoInactivoId),
                { $inc: { stock_inicial: -linea.cantidad } },
                { new: true },
              )
              .exec()
          : null;
      } catch (error) {
        this.logger.error(
          `Rebaja de stock ambigua (${this.detalle(factura, linea)}): pudo aplicarse o no, conciliar a mano; no se compensa: ${String(error)}`,
        );
        await this.compensarRebajas(factura, aplicados);
        throw error;
      }
      if (!actualizado) {
        await this.compensarRebajas(factura, aplicados);
        const motivo = await this.describirFallo(
          linea,
          factura,
          estadoInactivoId,
        );
        throw new ConflictException(
          `No se puede confirmar la factura ${factura.id}: ${motivo}`,
        );
      }
      aplicados.push({ ...linea, stockResultante: actualizado.stock_inicial });
    }

    await this.registrarKardex(factura, aplicados, KardexTipo.VENTA);
  }

  /**
   * Adds back the stock of every product of the invoice. A product that no
   * longer exists is warned about and skipped; a failed write is logged and
   * skipped: the invoice is already `cancelada` (terminal), so the rest of
   * the products must still get their stock back.
   */
  async restaurarStock(factura: FacturaParaInventario): Promise<void> {
    const aplicados: MovimientoAplicado[] = [];

    for (const linea of agregarCantidadesPorProducto(factura.items)) {
      const detalle = this.detalle(factura, linea);
      try {
        const actualizado = Types.ObjectId.isValid(linea.productoId)
          ? await this.productoModel
              .findOneAndUpdate(
                { _id: linea.productoId },
                { $inc: { stock_inicial: linea.cantidad } },
                { new: true },
              )
              .exec()
          : null;
        if (!actualizado) {
          this.logger.warn(
            `Producto inexistente al restaurar stock, se omite (${detalle})`,
          );
          continue;
        }
        aplicados.push({
          ...linea,
          stockResultante: actualizado.stock_inicial,
        });
      } catch (error) {
        this.logger.error(
          `No se pudo restaurar el stock, corregir a mano (${detalle}): ${String(error)}`,
        );
      }
    }

    await this.registrarKardex(factura, aplicados, KardexTipo.DEVOLUCION);
  }

  /**
   * Read-only lookup of the "Inactivo" estado nomenclador (same name
   * `ProductoService.actualizarEstadoSegunStock` uses, matched
   * case-insensitively like `EstadoService.findOrCreate`). Never created
   * from here: if it does not exist, no product can be inactive.
   */
  private async obtenerEstadoInactivoId(): Promise<string | null> {
    const estado = await this.estadoModel
      .findOne({ estado: { $regex: /^inactivo$/i } })
      .exec();
    return estado ? estado._id.toString() : null;
  }

  private filtroRebaja(
    linea: LineaInventario,
    factura: FacturaParaInventario,
    estadoInactivoId: string | null,
  ): QueryFilter<Producto> {
    // `_id` is a real ObjectId path (Mongoose casts the string). `almacen`
    // is `Mixed` (never cast), so it may hold the ObjectId or its hex string
    // (T7c): every form is listed. `estado` is a String path (always a
    // string), so only its hex forms are listed.
    const filtro: QueryFilter<Producto> = {
      _id: linea.productoId,
      stock_inicial: { $gte: linea.cantidad },
    };
    if (estadoInactivoId) {
      filtro.estado = { $nin: variantesHex(estadoInactivoId) };
    }
    if (factura.almacenId) {
      // A product without an assigned warehouse matches any invoice (T2).
      filtro.almacen = { $in: [null, ...variantesId(factura.almacenId)] };
    }
    return filtro;
  }

  /** Reads the product after a guarded decrement matched nothing, for the 409. */
  private async describirFallo(
    linea: LineaInventario,
    factura: FacturaParaInventario,
    estadoInactivoId: string | null,
  ): Promise<string> {
    const producto = Types.ObjectId.isValid(linea.productoId)
      ? await this.productoModel.findById(linea.productoId).exec()
      : null;
    if (!producto) {
      return `el producto ${linea.productoId} no existe`;
    }
    const nombre = `"${producto.nombre_producto}" (${linea.productoId})`;
    // Compared in canonical form: the stored value may be an ObjectId or a
    // hex string in any case (T7c).
    if (estadoInactivoId && mismoId(producto.estado, estadoInactivoId)) {
      return `el producto ${nombre} está inactivo`;
    }
    if (
      factura.almacenId &&
      producto.almacen &&
      !mismoId(producto.almacen, factura.almacenId)
    ) {
      return `el producto ${nombre} no pertenece al almacén de la factura`;
    }
    if (producto.stock_inicial >= linea.cantidad) {
      // Another writer raised the stock between the failed decrement and
      // this read, so "insuficiente" would contradict the numbers shown.
      return `el stock del producto ${nombre} cambió durante la confirmación (disponible ahora ${producto.stock_inicial}, solicitado ${linea.cantidad}); reintente`;
    }
    return `stock insuficiente para el producto ${nombre}: disponible ${producto.stock_inicial}, solicitado ${linea.cantidad}`;
  }

  /**
   * Undoes the decrements already applied. A compensation that fails (or
   * matches no product) cannot be retried safely here, so it is logged with
   * everything needed to fix the stock by hand, and the rest continue.
   */
  private async compensarRebajas(
    factura: FacturaParaInventario,
    aplicados: MovimientoAplicado[],
  ): Promise<void> {
    for (const linea of aplicados) {
      const detalle = this.detalle(factura, linea);
      try {
        const resultado = await this.productoModel
          .updateOne(
            { _id: linea.productoId },
            { $inc: { stock_inicial: linea.cantidad } },
          )
          .exec();
        if (resultado.matchedCount !== 1) {
          this.logger.error(
            `Compensación de stock sin producto, corregir a mano (${detalle})`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Compensación de stock fallida, corregir a mano (${detalle}): ${String(error)}`,
        );
      }
    }
  }

  private async registrarKardex(
    factura: FacturaParaInventario,
    aplicados: MovimientoAplicado[],
    tipo: KardexTipo.VENTA | KardexTipo.DEVOLUCION,
  ): Promise<void> {
    if (aplicados.length === 0) {
      return;
    }
    const accion = tipo === KardexTipo.VENTA ? 'confirmada' : 'cancelada';
    const entradas = aplicados.map((linea) => ({
      productoId: new Types.ObjectId(linea.productoId),
      tipo,
      cantidad: linea.cantidad,
      stock: linea.stockResultante,
      motivo: `Factura ${factura.id} ${accion}`,
      referencia: factura.id,
    }));
    try {
      // Unordered: an invalid row is skipped and the valid ones still land.
      // `throwOnValidationError` reports the skipped rows instead of
      // silently returning only the inserted ones.
      await this.kardexModel.insertMany(entradas, {
        ordered: false,
        throwOnValidationError: true,
      });
    } catch (error) {
      // Stock already changed and is the source of truth: never rolled back.
      const fallidas = filasKardexFallidas(error, entradas.length);
      this.logger.error(
        `No se pudo registrar el Kardex ${tipo} de la factura ${factura.id} (${fallidas.length} de ${entradas.length} filas); el stock ya se aplicó, registrar a mano: ${JSON.stringify(fallidas.map((i) => entradas[i]))}: ${String(error)}${detalleErroresKardex(error)}`,
      );
    }
  }

  private detalle(
    factura: FacturaParaInventario,
    linea: LineaInventario,
  ): string {
    return `factura ${factura.id}, producto ${linea.productoId}, cantidad ${linea.cantidad}`;
  }
}
