import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ConfiguracionDepositoDocument =
  HydratedDocument<ConfiguracionDeposito>;

/** Clave del único documento de configuración. */
export const CLAVE_CONFIG_DEPOSITO = 'deposito';

export const PLAZO_DIAS_HABILES_POR_DEFECTO = 1;
export const MAX_DIAS_ENTRE_DEPOSITOS_POR_DEFECTO = 5;

/**
 * Configuración de las alertas de plazo de depósito. Un único documento. Las
 * alertas están APAGADAS hasta confirmar la norma con su texto primario
 * (Res. 74/2026 BCC, hoy solo verificada por fuente secundaria).
 */
@Schema({ timestamps: true, collection: 'configuracion_deposito' })
export class ConfiguracionDeposito {
  @Prop({ required: true, unique: true, default: CLAVE_CONFIG_DEPOSITO })
  clave!: string;

  @Prop({ required: true, default: false })
  alertasActivas!: boolean;

  /** Días hábiles para depositar el efectivo de un turno cerrado. */
  @Prop({ required: true, default: PLAZO_DIAS_HABILES_POR_DEFECTO, min: 0 })
  plazoDiasHabiles!: number;

  /** Máximo de días de calendario entre dos depósitos. */
  @Prop({
    required: true,
    default: MAX_DIAS_ENTRE_DEPOSITOS_POR_DEFECTO,
    min: 1,
  })
  maxDiasEntreDepositos!: number;
}

export const ConfiguracionDepositoSchema = SchemaFactory.createForClass(
  ConfiguracionDeposito,
);

export interface ConfiguracionDepositoPlana {
  alertasActivas: boolean;
  plazoDiasHabiles: number;
  maxDiasEntreDepositos: number;
}
