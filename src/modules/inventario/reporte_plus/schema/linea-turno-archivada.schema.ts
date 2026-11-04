import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  MetodoPagoReporte,
  OrigenReporte,
  ProductoReporte,
} from './reporte_plus.schema';

export type LineaTurnoArchivadaDocument = HydratedDocument<LineaTurnoArchivada>;

/**
 * Copia de cada línea del Reporte Plus que se archiva al cerrar el turno,
 * antes de borrar las filas abiertas (doc §6.6: no destruir la evidencia del
 * detalle por producto). Se enlaza al historial por `turnoReportePlusId`.
 */
@Schema({ timestamps: true, collection: 'lineas_turno_archivadas' })
export class LineaTurnoArchivada {
  /** `_id` del `TurnoReportePlus` (resumen) al que pertenece la línea. */
  @Prop({
    type: Types.ObjectId,
    ref: 'TurnoReportePlus',
    required: true,
    index: true,
  })
  turnoReportePlusId!: Types.ObjectId;

  @Prop({ type: Date, required: true, index: true })
  fecha!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  productoId!: Types.ObjectId;

  @Prop({ type: ProductoReporte })
  producto?: ProductoReporte;

  @Prop({ required: true, min: 0 })
  cantidadVendida!: number;

  @Prop({ required: true, min: 0 })
  stockFinal!: number;

  @Prop({ type: String, required: true, enum: MetodoPagoReporte })
  metodoPago!: MetodoPagoReporte;

  @Prop({ required: true, default: 'CUP' })
  moneda!: string;

  @Prop({ required: true, min: 0 })
  total!: number;

  @Prop({ min: 0, default: 0 })
  descuento!: number;

  @Prop({ min: 0, default: 0 })
  impuesto!: number;

  @Prop({ type: String, enum: OrigenReporte })
  origen?: OrigenReporte;

  @Prop({ required: true })
  referencia!: string;

  @Prop({ default: false })
  enKardex!: boolean;
}

export const LineaTurnoArchivadaSchema =
  SchemaFactory.createForClass(LineaTurnoArchivada);
