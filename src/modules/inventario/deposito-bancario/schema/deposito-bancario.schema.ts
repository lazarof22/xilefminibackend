import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DepositoBancarioDocument = HydratedDocument<DepositoBancario>;

/** Depósito bancario del efectivo de un turno de caja (doc §6.6). */
@Schema({ timestamps: true, collection: 'depositos_bancarios' })
export class DepositoBancario {
  @Prop({ type: Types.ObjectId, ref: 'TurnoCaja', required: true, index: true })
  turnoCajaId!: Types.ObjectId;

  @Prop({ required: true, min: 0.01 })
  monto!: number;

  /** Código de la moneda (CUP por defecto). */
  @Prop({ required: true, default: 'CUP' })
  moneda!: string;

  @Prop({ required: true, trim: true })
  banco!: string;

  /** Número de boleta, cheque o comprobante del depósito. */
  @Prop({ trim: true })
  referencia?: string;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  fecha!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Usuarios' })
  registradoPor?: Types.ObjectId;
}

export const DepositoBancarioSchema =
  SchemaFactory.createForClass(DepositoBancario);
