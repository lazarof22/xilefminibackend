import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConfiguracionPagosDocument = HydratedDocument<ConfiguracionPagos>;

/** Clave del documento único con los parámetros de cobro. */
export const CLAVE_CONFIG_PAGOS = 'pagos';

/**
 * Qué tasa de la colección `tasas` se usa para convertir entre monedas al
 * cobrar: la oficial del Banco Central o la del mercado informal.
 */
export const TIPOS_TASA = ['tasaBancoCentral', 'tasaMercadoInformal'] as const;
export type TipoTasa = (typeof TIPOS_TASA)[number];

/** Sin configurar se usa la tasa del mercado informal, la que rige en las transacciones diarias. */
export const TIPO_TASA_POR_DEFECTO: TipoTasa = 'tasaMercadoInformal';

/**
 * Parámetros de cobro (colección `config_pagos`). Un documento por `clave`;
 * hoy solo existe `pagos`. Sin documento, rigen los valores por defecto.
 */
@Schema({ collection: 'config_pagos', timestamps: true })
export class ConfiguracionPagos {
  @Prop({ required: true, unique: true, default: CLAVE_CONFIG_PAGOS })
  clave!: string;

  @Prop({
    type: String,
    required: true,
    enum: [...TIPOS_TASA],
    default: TIPO_TASA_POR_DEFECTO,
  })
  tipoTasa!: TipoTasa;

  @Prop()
  actualizadoPor?: string;
}

export const ConfiguracionPagosSchema =
  SchemaFactory.createForClass(ConfiguracionPagos);
