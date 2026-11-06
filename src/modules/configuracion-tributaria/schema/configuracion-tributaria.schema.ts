import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConfiguracionTributariaDocument =
  HydratedDocument<ConfiguracionTributaria>;

/** Clave del documento único con el impuesto sobre las ventas. */
export const CLAVE_CONFIG_VENTAS = 'ventas';

/**
 * Parámetros tributarios (colección `config_tributaria`). Un documento por
 * `clave`; hoy solo existe `ventas`: el porcentaje de impuesto que el servidor
 * aplica a las ventas del punto de venta. Sin documento, el impuesto es 0 %,
 * que es lo que el punto de venta aplicaba hasta ahora.
 *
 * La pantalla para editarlo llega en la Fase 5 (Configuración); mientras tanto
 * se cambia directamente en la base de datos (ver README de la venta).
 */
@Schema({ collection: 'config_tributaria', timestamps: true })
export class ConfiguracionTributaria {
  @Prop({ required: true, unique: true, default: CLAVE_CONFIG_VENTAS })
  clave!: string;

  /** Impuesto sobre ventas en % (0 a 100). */
  @Prop({ required: true, min: 0, max: 100, default: 0 })
  impuestoVentasPorciento!: number;

  @Prop()
  actualizadoPor?: string;
}

export const ConfiguracionTributariaSchema = SchemaFactory.createForClass(
  ConfiguracionTributaria,
);
