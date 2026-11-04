import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Atomic counter for the correlative number of normative documents
 * (SC-2-04, SC-2-08, SC-2-16, SC-3-06). One document per document type.
 * Numbers are never reused.
 */
@Schema({ collection: 'consecutivos_documentos', versionKey: false })
export class ConsecutivoDocumento {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export const ConsecutivoDocumentoSchema =
  SchemaFactory.createForClass(ConsecutivoDocumento);
