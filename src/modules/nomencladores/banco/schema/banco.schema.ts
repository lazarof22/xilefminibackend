import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type BancoDocument = HydratedDocument<Banco>;

/**
 * Banco (colección `bancos`), usado por las transferencias del punto de venta.
 * Se llena la primera vez con BPA, BANDEC, BM y BICSA, sin prefijos: los
 * prefijos de tarjeta de cada uno los configura el administrador (ver
 * `prefijo-tarjeta.ts`).
 */
@Schema({ collection: 'bancos', timestamps: true })
export class Banco {
  /** Código corto único, en mayúsculas: BPA, BANDEC, BM... */
  @Prop({ required: true, unique: true, trim: true, uppercase: true })
  codigo!: string;

  @Prop({ required: true, trim: true })
  nombre!: string;

  /**
   * Patrones con los que empieza el número de las tarjetas del banco (dígitos y
   * `?`). Vacío = no se valida el número de tarjeta contra este banco.
   */
  @Prop({ type: [String], default: [] })
  prefijosTarjeta!: string[];

  @Prop({ default: true })
  activo!: boolean;
}

export const BancoSchema = SchemaFactory.createForClass(Banco);
