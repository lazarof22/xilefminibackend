import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TIPOS_TASA } from '../../../configuracion-pagos/schema/configuracion-pagos.schema';

/**
 * Tasas con las que se hizo un cobro en otra moneda, guardadas en el pago: la
 * tasa del día no permite reconstruir la operación, esta sí. Todas son CUP por
 * 1 unidad de la moneda.
 */
@Schema({ _id: false })
export class TasaUsadaSnapshot {
  /** Cuál de las dos tasas de la colección `tasas` se usó. */
  @Prop({ type: String, required: true, enum: [...TIPOS_TASA] })
  tipo!: string;

  /** Moneda en la que el cliente entregó el dinero. */
  @Prop({ required: true })
  monedaPago!: string;

  @Prop({ required: true, min: 0 })
  tasaPago!: number;

  /** Moneda en la que se devolvió el cambio (solo en efectivo). */
  @Prop()
  monedaCambio?: string;

  @Prop({ min: 0 })
  tasaCambio?: number;

  /** Fecha de la tasa más reciente entre las usadas. */
  @Prop({ type: Date })
  fecha?: Date;
}

export const TasaUsadaSnapshotSchema =
  SchemaFactory.createForClass(TasaUsadaSnapshot);
