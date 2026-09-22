import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FacturaContadorDocument = HydratedDocument<FacturaContador>;

/**
 * Atomic counter used to allocate correlative invoice numbers.
 * One document per counter key, incremented with `$inc` to avoid
 * race conditions between concurrent invoice creations.
 */
@Schema({ collection: 'factura_contadores', versionKey: false })
export class FacturaContador {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export const FacturaContadorSchema =
  SchemaFactory.createForClass(FacturaContador);
