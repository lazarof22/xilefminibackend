import { Model, Types } from 'mongoose';
import { Producto } from '../producto/schemas/producto.schema';
import { Kardex } from './schema/kardex.schema';
import { ultimoCostoPromedio } from './costo-promedio.consulta';
import { costoVigente } from './costo-promedio.util';

/** The only logger capability the helper needs (Nest's `Logger` satisfies it). */
export interface AvisadorDeCosto {
  warn(mensaje: string): void;
}

/**
 * Unit cost at which an OUT movement (sale, reversal, transfer) is valued
 * (SC-2-13): the product's latest average cost from the Kardex or, without
 * one, `Producto.precio_compra`. An OUT never changes the average.
 *
 * It NEVER throws: a failed read must not block a business operation that is
 * already applied. On error it logs a warning and returns `undefined`, so the
 * Kardex entry is written without valuation.
 */
export async function costoDeSalida(
  kardexModel: Pick<Model<Kardex>, 'findOne'>,
  productoModel: Pick<Model<Producto>, 'findById'> | undefined,
  productoId: string | Types.ObjectId,
  logger?: AvisadorDeCosto,
): Promise<number | undefined> {
  try {
    const producto = await productoModel
      ?.findById(productoId)
      .select('precio_compra')
      .lean()
      .exec();
    return costoVigente(
      await ultimoCostoPromedio(kardexModel, productoId),
      producto?.precio_compra,
    );
  } catch (error) {
    logger?.warn(
      `No se pudo valuar la salida del producto ${String(productoId)}; el asiento queda sin costo: ${String(error)}`,
    );
    return undefined;
  }
}
