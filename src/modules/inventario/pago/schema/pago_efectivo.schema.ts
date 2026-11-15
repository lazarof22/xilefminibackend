import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Pago } from './pago.schema';
import {
  TasaUsadaSnapshot,
  TasaUsadaSnapshotSchema,
} from './tasa-usada.schema';

export type PagoEfectivoDocument = HydratedDocument<PagoEfectivo>;

@Schema()
export class DesgloseBilletes {
  @Prop({ required: true, default: 0 })
  billete5000!: number;

  @Prop({ required: true, default: 0 })
  billete2000!: number;

  @Prop({ required: true, default: 0 })
  billete1000!: number;

  @Prop({ required: true, default: 0 })
  billete500!: number;

  @Prop({ required: true, default: 0 })
  billete200!: number;

  @Prop({ required: true, default: 0 })
  billete100!: number;

  @Prop({ required: true, default: 0 })
  billete50!: number;

  @Prop({ required: true, default: 0 })
  billete20!: number;

  @Prop({ required: true, default: 0 })
  billete10!: number;

  @Prop({ required: true, default: 0 })
  billete5!: number;

  @Prop({ required: true, default: 0 })
  billete3!: number;

  @Prop({ required: true, default: 0 })
  billete1!: number;
}

export enum TipoCliente {
  CLIENTEESTANDAR = 'cliente-estandar',
  CLIENTEPORDESCUENTO = 'cliente-por-descuento',
  CLIENTECUENTACASA = 'cliente-cuenta-casa',
}

@Schema()
export class DatosClienteDescuento {
  @Prop({ required: true })
  nombre!: string;

  @Prop({ required: true })
  ci!: string;

  @Prop({ required: true })
  telefono!: string;
}

/** Cantidad de billetes o monedas de un valor (Fase 3: desglose por denominaciones de la moneda). */
@Schema({ _id: false })
export class LineaDesglose {
  @Prop({ required: true, min: 0.01 })
  valor!: number;

  @Prop({ required: true, min: 1 })
  cantidad!: number;
}

export const LineaDesgloseSchema = SchemaFactory.createForClass(LineaDesglose);

@Schema()
export class PagoEfectivo extends Pago {
  @Prop({ type: DesgloseBilletes, required: false })
  desglose?: DesgloseBilletes;

  @Prop({})
  monto_pagar_CUP!: number;

  @Prop({})
  monto_pagar_alCambio!: number;

  @Prop({ required: false })
  cambio?: number;

  @Prop({
    required: false,
    enum: TipoCliente,
    default: TipoCliente.CLIENTEESTANDAR,
  })
  cliente?: TipoCliente;

  @Prop()
  monto_pagado!: number;

  /**
   * Código de la moneda en la que el cliente entregó el efectivo (CUP, USD,
   * EUR...). Los pagos anteriores a la Fase 3 no la llevan y eran en CUP.
   */
  @Prop({ type: String, required: false })
  moneda?: string;

  /**
   * Desglose por denominaciones de `moneda` (Fase 3), de mayor a menor valor.
   * Es una lista y no un mapa porque Mongoose no admite claves con punto
   * ("0.5") en un Map.
   */
  @Prop({ type: [LineaDesgloseSchema], default: undefined })
  desgloseDenominaciones?: LineaDesglose[];

  /** Moneda en la que se devolvió el cambio, si difiere de `moneda`. */
  @Prop({ type: String, required: false })
  monedaCambio?: string;

  /** El cambio expresado en `monedaCambio` (`cambio` está en `moneda`). */
  @Prop({ required: false, min: 0 })
  cambioConvertido?: number;

  /** Tasas usadas (solo si el pago o el cambio fue en una moneda distinta del CUP). */
  @Prop({ type: TasaUsadaSnapshotSchema, required: false })
  tasaUsada?: TasaUsadaSnapshot;

  // ✅ NUEVO: Datos del cliente cuando es "cliente-por-descuento"
  @Prop({ type: DatosClienteDescuento, required: false })
  datosClienteDescuento?: DatosClienteDescuento;

  // ✅ NUEVO: Indica si es cliente cuenta casa (monto pagado = 0)
  @Prop({ required: true, default: false })
  esCuentaCasa!: boolean;
}

export const PagoEfectivoSchema = SchemaFactory.createForClass(PagoEfectivo);
