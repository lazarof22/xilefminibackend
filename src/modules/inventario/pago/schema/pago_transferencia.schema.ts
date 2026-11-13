import { Prop, SchemaFactory, Schema } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CODIGOS_CANAL_PAGO,
  type CanalPago,
} from '../../../nomencladores/canal-pago/canal-pago.catalogo';
import { Pago } from './pago.schema';
import {
  TasaUsadaSnapshot,
  TasaUsadaSnapshotSchema,
} from './tasa-usada.schema';

export type PagoTransferenciaDocument = HydratedDocument<PagoTransferencia>;

export const TIPOS_CUENTA = ['cuenta', 'tarjeta'] as const;
export type TipoCuenta = (typeof TIPOS_CUENTA)[number];

@Schema()
export class PagoTransferencia extends Pago {
  /** Número de la cuenta o de la tarjeta (o la referencia, en los canales sin banco). */
  @Prop()
  numeroCuenta!: string;

  /** Código del banco (BPA, BANDEC...). */
  @Prop()
  banco?: string;

  @Prop()
  notas?: string;

  /** Total de la venta en CUP. */
  @Prop()
  montoPagar!: number;

  // Compatibilidad con el contrato del frontend (ventaService)
  @Prop()
  ciCliente?: string;

  @Prop()
  nombreCliente?: string;

  @Prop()
  referenciaPago?: string;

  @Prop({ type: Types.ObjectId, ref: 'Cliente', required: false })
  clienteId?: Types.ObjectId;

  /** Por dónde llegó el dinero (Fase 3). Zelle es un canal, no una moneda. */
  @Prop({ type: String, enum: [...CODIGOS_CANAL_PAGO] })
  canal?: CanalPago;

  /** Banco del nomenclador (Fase 3), cuando el canal es una transferencia bancaria. */
  @Prop({ type: Types.ObjectId, ref: 'Banco', required: false })
  bancoId?: Types.ObjectId;

  @Prop({ type: String, enum: [...TIPOS_CUENTA] })
  tipoCuenta?: TipoCuenta;

  /** Código de la moneda transferida (CUP, USD...). Los pagos anteriores no la llevan y eran CUP. */
  @Prop({ type: String })
  moneda?: string;

  /** Lo transferido, en `moneda` (`montoPagar` es el total en CUP). */
  @Prop({ min: 0 })
  montoMoneda?: number;

  /** Tasa usada cuando `moneda` no es CUP. */
  @Prop({ type: TasaUsadaSnapshotSchema, required: false })
  tasaUsada?: TasaUsadaSnapshot;
}

export const PagoTransferenciaSchema =
  SchemaFactory.createForClass(PagoTransferencia);
