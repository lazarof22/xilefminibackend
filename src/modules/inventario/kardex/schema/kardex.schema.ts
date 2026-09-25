import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type KardexDocument = HydratedDocument<Kardex>;

export enum KardexTipo {
  ENTRADA = 'entrada',
  SALIDA = 'salida',
  VENTA = 'venta',
  COMPRA = 'compra',
  TRANSFERENCIA_SALIDA = 'transferencia_salida',
  TRANSFERENCIA_ENTRADA = 'transferencia_entrada',
  DEVOLUCION = 'devolucion',
}

@Schema({ timestamps: true })
export class Kardex {
  @Prop({ type: Date, default: Date.now })
  fecha!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  productoId!: Types.ObjectId;

  @Prop({ required: true, enum: KardexTipo })
  tipo!: KardexTipo;

  @Prop({ required: true, min: 1 })
  cantidad!: number;

  @Prop({ required: true, min: 0 })
  stock!: number;

  @Prop({ required: true })
  motivo!: string;

  // Optional business document that caused the movement (e.g. the
  // invoice id `FAC-000012` for factura confirm/cancel). Optional so
  // existing writers and documents stay valid.
  @Prop()
  referencia?: string;
}

export const KardexSchema = SchemaFactory.createForClass(Kardex);
