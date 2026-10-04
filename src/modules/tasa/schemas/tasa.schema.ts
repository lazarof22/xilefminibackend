import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TasaDocument = HydratedDocument<Tasa>;


@Schema({ timestamps: true, collection: 'tasas' })
export class Tasa {
  @Prop({ required: true, unique: true, index: true })
  moneda!: string;

  @Prop({ required: true, min: 0 })
  tasaBancoCentral!: number; // Tasa oficial

  @Prop({ required: true, min: 0 })
  tasaMercadoInformal!: number; // Tasa informal

  @Prop({ min: 0, default: 0 })
  iva?: number;

  @Prop({ default: true })
  activa!: boolean;
}

export const TasaSchema = SchemaFactory.createForClass(Tasa);
