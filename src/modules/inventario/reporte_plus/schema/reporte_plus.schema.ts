import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReportePlusDocument = HydratedDocument<ReportePlus>;

/** Métodos de pago que desglosa el Reporte Plus. */
export enum MetodoPagoReporte {
  EFECTIVO = 'efectivo',
  CREDITO = 'credito',
  TRANSFERENCIA = 'transferencia',
  FACTURA = 'factura',
}

/** Quién generó la fila: el punto de venta o una factura confirmada. */
export enum OrigenReporte {
  VENTA = 'venta',
  FACTURA = 'factura',
}

/** Copia (snapshot) del producto al momento de la venta. */
@Schema({ _id: false })
export class ProductoReporte {
  @Prop({ required: true })
  codigo!: string;

  @Prop({ required: true })
  nombre!: string;
}

/**
 * Una fila por producto vendido en el turno actual. Se vacía al cerrar el
 * turno (después de pasar los movimientos al Kardex y guardar el resumen).
 */
@Schema({ timestamps: true, collection: 'reporteplus' })
export class ReportePlus {
  @Prop({ type: Date, default: Date.now, index: true })
  fecha!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  productoId!: Types.ObjectId;

  @Prop({ type: ProductoReporte, required: true })
  producto!: ProductoReporte;

  @Prop({ required: true, min: 0 })
  cantidadVendida!: number;

  @Prop({ required: true, min: 0 })
  stockFinal!: number;

  @Prop({ required: true, enum: MetodoPagoReporte })
  metodoPago!: MetodoPagoReporte;

  /** Total pagado por la línea (descuento e impuesto ya aplicados). */
  @Prop({ required: true, min: 0 })
  total!: number;

  @Prop({ required: true, min: 0, default: 0 })
  descuento!: number;

  @Prop({ required: true, min: 0, default: 0 })
  impuesto!: number;

  @Prop({ required: true, enum: OrigenReporte, default: OrigenReporte.VENTA })
  origen!: OrigenReporte;

  /** Id de la venta (POS) o número de factura: agrupa las líneas de un mismo pago. */
  @Prop({ required: true })
  referencia!: string;

  /**
   * true cuando el Kardex ya tiene el movimiento (las facturas confirmadas lo
   * escriben al confirmar); el cierre de turno no lo duplica.
   */
  @Prop({ required: true, default: false })
  enKardex!: boolean;

  /** Marca de cierre: id del turno que reclamó la fila mientras se cierra. */
  @Prop({ type: Types.ObjectId, index: true })
  turnoCierre?: Types.ObjectId;
}

export const ReportePlusSchema = SchemaFactory.createForClass(ReportePlus);
