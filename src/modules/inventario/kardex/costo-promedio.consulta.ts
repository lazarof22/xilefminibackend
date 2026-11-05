import { Model, Types } from 'mongoose';
import { ambosTipos } from '../exitencia/existencia.types';
import { Kardex } from './schema/kardex.schema';

/**
 * `costoPromedio` de la fila MÁS RECIENTE del kardex del producto que lo
 * tenga (las filas de venta/factura no lo escriben y se saltan). `undefined`
 * si el producto aún no tiene promedio.
 *
 * El `productoId` del kardex es `Mixed` en Mongoose: se aceptan ambos tipos.
 */
export async function ultimoCostoPromedio(
  kardexModel: Pick<Model<Kardex>, 'findOne'>,
  productoId: string | Types.ObjectId,
): Promise<number | undefined> {
  const id = new Types.ObjectId(String(productoId));
  const fila = await kardexModel
    .findOne({
      productoId: { $in: ambosTipos(id) },
      costoPromedio: { $exists: true, $ne: null },
    })
    .sort({ _id: -1 })
    .select('costoPromedio')
    .lean()
    .exec();

  const promedio = fila?.costoPromedio;
  return typeof promedio === 'number' ? promedio : undefined;
}
