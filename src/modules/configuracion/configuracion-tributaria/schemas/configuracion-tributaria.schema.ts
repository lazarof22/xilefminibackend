import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConfiguracionTributariaDocument =
  HydratedDocument<ConfiguracionTributaria>;

/**
 * Bonificación del impuesto sobre ventas por programa/sector
 * (Res. 161/2026: p. ej. 5 %). Vive dentro de la configuración vigente.
 */
@Schema({ _id: false })
export class BonificacionTributaria {
  @Prop({ required: true, trim: true })
  programa!: string;

  @Prop({ trim: true })
  sector?: string;

  @Prop({ required: true, min: 0, max: 100 })
  impuestoVentasPct!: number;

  @Prop({ default: true })
  activa!: boolean;
}

export const BonificacionTributariaSchema = SchemaFactory.createForClass(
  BonificacionTributaria,
);

/**
 * Configuración tributaria (doc §6.7). Está fuera de `Tasa`. Cada guardado
 * crea un documento nuevo y desactiva el anterior: los anteriores se
 * conservan para auditoría.
 */
@Schema({ timestamps: true, collection: 'configuracion_tributaria' })
export class ConfiguracionTributaria {
  @Prop({ required: true, min: 0, max: 100 })
  impuestoVentasPct!: number;

  @Prop({ type: Date, required: true, index: true })
  vigenteDesde!: Date;

  @Prop({ default: true, index: true })
  activa!: boolean;

  @Prop({ type: [BonificacionTributariaSchema], default: [] })
  bonificaciones!: BonificacionTributaria[];
}

export const ConfiguracionTributariaSchema = SchemaFactory.createForClass(
  ConfiguracionTributaria,
);
