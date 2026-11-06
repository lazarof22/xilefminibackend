import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VentaContadorDocument = HydratedDocument<VentaContador>;

/** Id fijo del contador del comprobante simplificado del punto de venta. */
export const CONTADOR_COMPROBANTE_POS = 'comprobante-pos';

/**
 * Contador atómico del número de comprobante de las ventas del POS. Un
 * documento por contador, incrementado con `$inc` para que dos cajeros nunca
 * reciban el mismo número.
 */
@Schema({ collection: 'venta_contadores', versionKey: false })
export class VentaContador {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export const VentaContadorSchema = SchemaFactory.createForClass(VentaContador);
