import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConfiguracionInventarioDocument =
  HydratedDocument<ConfiguracionInventario>;

/** Clave del único documento de configuración del inventario. */
export const CLAVE_CONFIG_INVENTARIO = 'inventario';

/**
 * Configuración global del inventario (un solo documento).
 *
 * `existenciasUnificadas` es la compuerta de la Fase 1: mientras sea `false`
 * la venta, la factura y los ajustes siguen descontando `Producto.stock_inicial`
 * como siempre. Solo se pone en `true` desde la conciliación, cuando el saldo
 * de cada producto coincide con la suma de sus existencias por ubicación.
 */
@Schema({ collection: 'configuracion_inventario', timestamps: true })
export class ConfiguracionInventario {
  @Prop({ required: true, unique: true, default: CLAVE_CONFIG_INVENTARIO })
  clave!: string;

  @Prop({ required: true, default: false })
  existenciasUnificadas!: boolean;

  @Prop({ type: Date })
  unificadoEn?: Date;

  @Prop({ type: String })
  unificadoPor?: string;
}

export const ConfiguracionInventarioSchema = SchemaFactory.createForClass(
  ConfiguracionInventario,
);
