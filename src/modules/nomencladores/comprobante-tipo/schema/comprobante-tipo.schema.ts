import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ComprobanteTipoDocument = HydratedDocument<ComprobanteTipo>;

@Schema({ timestamps: true })
export class ComprobanteTipo {
  @Prop({ required: true, unique: true })
  codigo!: string;

  @Prop({ required: true })
  nombre!: string;

  @Prop()
  descripcion?: string;
}

export const ComprobanteTipoSchema =
  SchemaFactory.createForClass(ComprobanteTipo);