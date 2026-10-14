import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CompraDocument = HydratedDocument<Compra>;

export enum Pago {
  EFECTIVO = 'efectivo',
  TRANSFERENCIA = 'transferencia',
  CREDITO = 'credito',
}

/**
 * Compra a un proveedor, tal y como se registra desde Compras > Registrar compra.
 *
 * - `moneda` es el tipo de moneda (CUP, USD, EUR, ...). Con CUP no se usan tasas.
 * - Si la moneda no es CUP se usa UNA tasa según el tipo de proveedor:
 *     · Mypime  -> `tasaMercadoInformal`
 *     · Resto   -> `tasaBancoNacional`
 *   La otra no se guarda.
 * - `totalPagado` = `precioCompra` × `cantidad`. Lo calcula el servidor.
 */
@Schema({ timestamps: true })
export class Compra {
  @Prop({ required: true, trim: true })
  numeroFactura!: string;

  @Prop({ required: true, trim: true })
  nombreProveedor!: string;

  @Prop({ required: true, trim: true })
  nombreProducto!: string;

  @Prop({ type: Date, required: true })
  fechaCompra!: Date;

  @Prop({ required: true, trim: true })
  moneda!: string;

  @Prop({ min: 0 })
  tasaMercadoInformal?: number;

  @Prop({ min: 0 })
  tasaBancoNacional?: number;

  @Prop({ required: true, min: 0 })
  precioCompra!: number;

  @Prop({ required: true, min: 1 })
  cantidad!: number;

  @Prop({ required: true, min: 0, default: 0 })
  iva!: number;

  @Prop({ required: true, min: 0 })
  totalPagado!: number;

  @Prop({ required: true, enum: Pago })
  metodoPago!: Pago;
}

export const CompraSchema = SchemaFactory.createForClass(Compra);

// Una misma factura no puede registrarse dos veces para el mismo proveedor.
CompraSchema.index({ numeroFactura: 1, nombreProveedor: 1 }, { unique: true });
CompraSchema.index({ fechaCompra: -1 });
