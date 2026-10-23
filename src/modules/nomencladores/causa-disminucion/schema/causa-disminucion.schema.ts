import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CausaDisminucionDocument = HydratedDocument<CausaDisminucion>;

/** Nomenclador "Causas de disminución" del ajuste de inventario. */
@Schema({ collection: 'causas_disminucion' })
export class CausaDisminucion {
  @Prop({ required: true, unique: true, trim: true })
  nombre_causa!: string;
}

export const CausaDisminucionSchema =
  SchemaFactory.createForClass(CausaDisminucion);
