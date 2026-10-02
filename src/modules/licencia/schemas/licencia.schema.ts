import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { LicenciaPayloadV3 } from '../services/payload-builder';

export type LicenciaDocument = HydratedDocument<Licencia>;

/**
 * One document per signed license (`license_id`). The signed payload and its
 * signature are stored VERBATIM; status is always re-derived from them (see
 * `licencia-estado.util.ts`). Denormalized fields (`empresa_id`, `secuencia`,
 * `emitida_en`) exist only for indexing/queries and are never trusted for the
 * validity decision.
 *
 * New collection name (`licencias_v3`): v0–v2 licenses are not accepted
 * anymore and the old collection carried incompatible unique indexes.
 */
@Schema({ timestamps: true, collection: 'licencias_v3' })
export class Licencia {
  @Prop({ required: true })
  license_id: string;

  @Prop({ required: true })
  empresa_id: string;

  @Prop({ required: true })
  secuencia: number;

  @Prop({ required: true })
  emitida_en: Date;

  @Prop({ required: true })
  version_firma: number;

  @Prop({ type: Object, required: true })
  payload: LicenciaPayloadV3;

  @Prop({ required: true })
  firma: string;

  @Prop({ required: true })
  importada_en: Date;

  /**
   * Unsigned, max-only clock floor (ms). It is only ever used to make the
   * clock check STRICTER (backup for a deleted state file), never to accept.
   */
  @Prop({ default: 0 })
  ultimo_visto_ms: number;
}

export const LicenciaSchema = SchemaFactory.createForClass(Licencia);

LicenciaSchema.index({ license_id: 1 }, { unique: true });
LicenciaSchema.index({ empresa_id: 1, emitida_en: -1 });
