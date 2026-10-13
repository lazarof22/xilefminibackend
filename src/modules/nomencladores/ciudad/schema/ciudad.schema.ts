import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Pais } from '../../pais/schema/pais.schema';

export type CiudadDocument = HydratedDocument<Ciudad>;

@Schema({ timestamps: true })
export class Ciudad {
  @Prop({ required: true, trim: true })
  nombreCiudad!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Pais.name,
    required: true,
    index: true,
  })
  pais!: Types.ObjectId;
}

export const CiudadSchema = SchemaFactory.createForClass(Ciudad);

// Una ciudad no se repite dentro del mismo país, pero sí puede existir en países distintos.
CiudadSchema.index({ pais: 1, nombreCiudad: 1 }, { unique: true });
