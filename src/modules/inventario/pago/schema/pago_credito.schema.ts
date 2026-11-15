import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CODIGO_PAIS_POR_DEFECTO,
  PATRON_CI,
  PATRON_NIT,
  TIPOS_IDENTIDAD,
  type TipoIdentidad,
} from '../../../../common/utils/identidad';
import { Pago } from './pago.schema';

export type PagoCreditoDocument = HydratedDocument<PagoCredito>;

@Schema()
export class PagoCredito extends Pago {
  @Prop({ type: Types.ObjectId, ref: 'Cliente', required: true })
  clienteId!: Types.ObjectId;

  @Prop()
  monto_pagar?: number;

  /** Con qué se identificó el cliente en esta venta (Fase 3). Los pagos anteriores no lo llevan. */
  @Prop({ type: String, enum: [...TIPOS_IDENTIDAD] })
  tipoIdentidad?: TipoIdentidad;

  /** Carnet de identidad (11 dígitos): obligatorio solo si `tipoIdentidad` es CI. */
  @Prop({
    type: String,
    match: [PATRON_CI, 'La CI debe tener 11 dígitos numéricos'],
    required: [
      function (this: PagoCredito): boolean {
        return this.tipoIdentidad === 'CI';
      },
      'La CI es obligatoria cuando la identidad es CI',
    ],
  })
  ci?: string;

  /** NIT: obligatorio solo si `tipoIdentidad` es NIT. */
  @Prop({
    type: String,
    match: [
      PATRON_NIT,
      'El NIT debe tener de 5 a 20 letras, números o guiones',
    ],
    required: [
      function (this: PagoCredito): boolean {
        return this.tipoIdentidad === 'NIT';
      },
      'El NIT es obligatorio cuando la identidad es NIT',
    ],
  })
  nit?: string;

  @Prop()
  telefono?: string;

  /** Prefijo de país del teléfono (seleccionable en pantalla). */
  @Prop({ default: CODIGO_PAIS_POR_DEFECTO })
  codigoPais?: string;
}

export const PagoCreditoSchema = SchemaFactory.createForClass(PagoCredito);
