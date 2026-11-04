import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExtraccionDocument = HydratedDocument<Extraccion>;

@Schema({ timestamps: true })
export class Extraccion {
  @Prop({ required: true })
  monto!: number;

  @Prop({ required: true })
  causa!: string;

  @Prop({ required: true, index: true })
  fecha!: Date;

  @Prop()
  responsable?: string;

  @Prop({ type: Types.ObjectId, ref: 'Usuarios' })
  empleadoId?: Types.ObjectId;

  /** Código de la moneda extraída (CUP si no se informa). */
  @Prop({ default: 'CUP' })
  moneda?: string;

  /** Turno de caja abierto del cajero al extraer (vacío si no tenía turno). */
  @Prop({ type: Types.ObjectId, ref: 'TurnoCaja', index: true })
  turnoCaja?: Types.ObjectId;
}

export const ExtraccionSchema = SchemaFactory.createForClass(Extraccion);
