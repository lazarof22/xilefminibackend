import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  CODIGO_PAIS_POR_DEFECTO,
  TIPOS_IDENTIDAD,
  type TipoIdentidad,
} from '../../../../common/utils/identidad';

export type ClienteDocument = HydratedDocument<Cliente>;

export enum TipoCliente {
  ESTANDAR = 'cliente_estandar',
  DESCUENTO = 'cliente_descuento',
  CUENTA_CASA = 'cliente_cuenta_casa',
}

@Schema()
export class Cliente {
  /** Documento de identidad: la CI (11 dígitos) o, en un cliente con NIT, el mismo NIT. */
  @Prop({ required: true, unique: true })
  id_cliente!: string;

  @Prop({ required: true })
  nombre_cliente!: string;

  @Prop()
  nit?: string;

  /**
   * Con qué se identifica: CI (persona natural) o NIT (empresa o mipyme). Es
   * independiente de la condición comercial (`tipo_cliente`).
   */
  @Prop({ type: String, enum: [...TIPOS_IDENTIDAD], default: 'CI' })
  tipoIdentidad!: TipoIdentidad;

  @Prop({ required: true, unique: true })
  telefono_cliente!: string;

  /** Prefijo de país del teléfono (+53, +1...). */
  @Prop({ default: CODIGO_PAIS_POR_DEFECTO })
  codigoPais!: string;

  @Prop({ required: true, unique: true })
  email_cliente!: string;

  @Prop({ required: true })
  direccion_cliente!: string;

  @Prop({
    required: true,
    enum: Object.values(TipoCliente),
    default: TipoCliente.ESTANDAR,
  })
  tipo_cliente!: TipoCliente;
}

export const ClienteSchema = SchemaFactory.createForClass(Cliente);
