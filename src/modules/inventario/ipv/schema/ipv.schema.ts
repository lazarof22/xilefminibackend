import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type IpvDocument = HydratedDocument<Ipv>;

/**
 * Fila del IPV (Informe de Producción y Ventas) de un producto en un día.
 * Los campos derivados se guardan calculados para consultas e informes.
 */
@Schema({ timestamps: true })
export class Ipv {
  /** Día del IPV en formato AAAA-MM-DD. */
  @Prop({ required: true, index: true })
  fecha!: string;

  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  producto!: Types.ObjectId;

  @Prop({ required: true })
  nombreProducto!: string;

  @Prop({ required: true, min: 0, default: 0 })
  precioCosto!: number;

  @Prop({ required: true, min: 0, default: 0 })
  precioVenta!: number;

  @Prop({ required: true, min: 0, default: 0 })
  inventarioInicial!: number;

  @Prop({ required: true, min: 0, default: 0 })
  entradas!: number;

  @Prop({ required: true, min: 0, default: 0 })
  ajusteDisminucion!: number;

  @Prop({ required: true, min: 0, default: 0 })
  venta!: number;

  @Prop({ required: true, min: 0, default: 0 })
  disponible!: number;

  @Prop({ required: true, min: 0, default: 0 })
  inventarioFinal!: number;

  @Prop({ required: true, min: 0, default: 0 })
  importeVenta!: number;

  @Prop({ required: true, min: 0, default: 0 })
  importeCosto!: number;
}

export const IpvSchema = SchemaFactory.createForClass(Ipv);
IpvSchema.index({ fecha: 1, producto: 1 }, { unique: true });
