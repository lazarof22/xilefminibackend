import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DevolucionAcumuladoDocument = HydratedDocument<DevolucionAcumulado>;

/**
 * Cantidad ya devuelta de un producto de un documento de origen.
 *
 * Es la compuerta atómica del tope "lo devuelto nunca supera lo vendido":
 * reservar es UNA escritura condicional (`devuelta <= vendida - cantidad`)
 * sobre este documento, así dos devoluciones simultáneas no pueden devolver
 * entre las dos más de lo vendido. Un fallo de la devolución libera su parte.
 */
@Schema({ timestamps: true, collection: 'devolucion_acumulados' })
export class DevolucionAcumulado {
  @Prop({ required: true })
  origenTipo!: string;

  /** Id del origen en hexadecimal. */
  @Prop({ required: true })
  origenId!: string;

  /** Id del producto en hexadecimal. */
  @Prop({ required: true })
  productoId!: string;

  /** Cantidad vendida/comprada cuando se creó el contador (informativa). */
  @Prop({ required: true, min: 0 })
  vendida!: number;

  @Prop({ required: true, min: 0, default: 0 })
  devuelta!: number;
}

export const DevolucionAcumuladoSchema =
  SchemaFactory.createForClass(DevolucionAcumulado);
DevolucionAcumuladoSchema.index(
  { origenTipo: 1, origenId: 1, productoId: 1 },
  { unique: true },
);
