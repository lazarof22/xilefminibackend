import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LICENCIA_AUDIT_ACCIONES } from '../constants/licencia.constants';

export type AuditoriaLicenciaDocument = HydratedDocument<AuditoriaLicencia>;

@Schema({ timestamps: true, collection: 'auditoria_licencias' })
export class AuditoriaLicencia {
  @Prop({ type: Types.ObjectId, ref: 'Licencia' })
  licencia_id?: Types.ObjectId;

  @Prop()
  license_id?: string;

  @Prop({ required: true, enum: LICENCIA_AUDIT_ACCIONES })
  accion: string;

  @Prop()
  empresa_id: string;

  @Prop({ type: Object })
  detalles?: Record<string, unknown>;

  @Prop({ default: true })
  exitoso: boolean;

  @Prop()
  error: string;

  @Prop()
  ip_origen: string;

  @Prop()
  user_agent: string;
}

export const AuditoriaLicenciaSchema =
  SchemaFactory.createForClass(AuditoriaLicencia);

AuditoriaLicenciaSchema.index({ licencia_id: 1, createdAt: -1 });
AuditoriaLicenciaSchema.index({ empresa_id: 1 });
AuditoriaLicenciaSchema.index({ accion: 1, exitoso: 1 });
