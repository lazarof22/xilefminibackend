import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProveedorDocument = HydratedDocument<Proveedor>;

/**
 * Proveedor (colección `proveedores`).
 *
 * - `codigo` es único y no distingue mayúsculas (F-01 y f-01 son el mismo).
 * - `telefono` es numérico, como se pidió: no admite "+", espacios ni ceros a la izquierda.
 */
@Schema({ collection: 'proveedores', timestamps: true })
export class Proveedor {
  @Prop({ required: true, trim: true })
  codigo!: string;

  @Prop({ required: true, trim: true })
  nombre!: string;

  @Prop({ required: true, trim: true })
  cuentaBancaria!: string;

  @Prop({ required: true, trim: true })
  direccion!: string;

  @Prop({ required: true, min: 0 })
  telefono!: number;
}

export const ProveedorSchema = SchemaFactory.createForClass(Proveedor);

/** Collation con la que se compara el código (ignora mayúsculas). */
export const COLLATION_CODIGO = { locale: 'es', strength: 2 } as const;

ProveedorSchema.index(
  { codigo: 1 },
  { unique: true, collation: COLLATION_CODIGO },
);
ProveedorSchema.index({ nombre: 1 });
