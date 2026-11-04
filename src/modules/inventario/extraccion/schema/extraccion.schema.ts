import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExtraccionDocument = HydratedDocument<Extraccion>;

/** Supervisor (administrador o gerente) que autorizó la extracción, para auditoría. */
@Schema({ _id: false })
export class AutorizadoPor {
  @Prop({ type: Types.ObjectId, ref: 'Usuarios', required: true })
  usuarioId!: Types.ObjectId;

  @Prop({ required: true })
  nombre!: string;
}
export const AutorizadoPorSchema = SchemaFactory.createForClass(AutorizadoPor);

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

  /** Quién autorizó la extracción (administrador o gerente). Los registros anteriores no lo tienen. */
  @Prop({ type: AutorizadoPorSchema })
  autorizadoPor?: AutorizadoPor;
}

export const ExtraccionSchema = SchemaFactory.createForClass(Extraccion);
