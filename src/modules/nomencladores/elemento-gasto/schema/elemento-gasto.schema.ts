import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ElementoGastoDocument = HydratedDocument<ElementoGasto>;

@Schema({ timestamps: true })
export class ElementoGasto {
  @Prop({ required: true, unique: true })
  codigo!: string;

  @Prop({ required: true })
  nombre!: string;

  @Prop()
  descripcion?: string;

  @Prop({ type: Types.ObjectId, ref: 'ElementoGasto', default: null })
  padre?: Types.ObjectId | null;

  @Prop({ default: 1 })
  nivel?: number;
}

export const ElementoGastoSchema = SchemaFactory.createForClass(ElementoGasto);
