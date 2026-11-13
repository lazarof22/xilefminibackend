import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DenominacionMonedaDocument = HydratedDocument<DenominacionMoneda>;

export const TIPOS_DENOMINACION = ['billete', 'moneda'] as const;
export type TipoDenominacion = (typeof TIPOS_DENOMINACION)[number];

/**
 * Billetes y monedas que existen de cada divisa (colección
 * `denominaciones_moneda`). El desglose del efectivo ya no está fijado en el
 * esquema del pago: la pantalla pide aquí qué denominaciones mostrar y el
 * servidor valida contra ellas lo que el cajero declara haber recibido.
 *
 * Por defecto: CUP hasta 5000; USD y EUR hasta 100.
 */
@Schema({ collection: 'denominaciones_moneda', timestamps: true })
export class DenominacionMoneda {
  /** Código de la moneda (`tipo_moneda` del nomenclador Moneda): CUP, USD, EUR... */
  @Prop({ required: true, trim: true, uppercase: true })
  moneda!: string;

  /** Valor facial, en la moneda indicada (hasta 2 decimales). */
  @Prop({ required: true, min: 0.01 })
  valor!: number;

  @Prop({
    type: String,
    required: true,
    enum: [...TIPOS_DENOMINACION],
    default: 'billete',
  })
  tipo!: TipoDenominacion;

  /** Una denominación inactiva deja de ofrecerse y de aceptarse, sin borrar su historia. */
  @Prop({ default: true })
  activa!: boolean;
}

export const DenominacionMonedaSchema =
  SchemaFactory.createForClass(DenominacionMoneda);

DenominacionMonedaSchema.index({ moneda: 1, valor: 1 }, { unique: true });
