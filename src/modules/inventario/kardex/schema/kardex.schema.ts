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
  AJUSTE = 'ajuste',
}

@Schema({ timestamps: true })
export class Kardex {
  @Prop({ type: Date, default: Date.now })
  fecha!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  productoId!: Types.ObjectId;

  @Prop({ required: true, enum: KardexTipo })
  tipo!: KardexTipo;

  // Greater than 0, fractions allowed (T7b): invoice items may sell 0.5
  // units. Every other writer (compra, transferencia, manual Kardex) writes
  // quantities >= 1, which still pass.
  @Prop({
    required: true,
    validate: {
      validator: (valor: number) => valor > 0,
      message: 'La cantidad debe ser mayor que 0',
    },
  })
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

  // Submayor SC-2-13 (doc §6.6). All optional so the existing writers
  // (factura, compra, transferencia) and stored documents stay valid.
  @Prop({ min: 0 })
  importeCUP?: number;

  @Prop({ min: 0 })
  importeDivisa?: number;

  @Prop({ min: 0 })
  costoPromedio?: number;

  @Prop()
  ubicacionFisica?: string;

  @Prop()
  referenciaContable?: string;
}

export const KardexSchema = SchemaFactory.createForClass(Kardex);
