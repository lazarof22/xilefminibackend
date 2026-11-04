import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AjusteInventarioDocument = HydratedDocument<AjusteInventario>;

/** Línea de un ajuste: el saldo antes y después lo fija el servidor. */
@Schema({ _id: false })
export class LineaAjuste {
  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  producto!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
  almacen!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contenedor', required: true })
  contenedor!: Types.ObjectId;

  /** Saldo leído de `Existencia` en el momento del ajuste. */
  @Prop({ required: true, min: 0 })
  saldoAntes!: number;

  /** Cantidad con signo: positiva suma, negativa resta; nunca cero. */
  @Prop({
    required: true,
    validate: {
      validator: (valor: number) => valor !== 0,
      message: 'El ajuste no puede ser cero',
    },
  })
  ajuste!: number;

  /** `saldoAntes + ajuste`; nunca negativo. */
  @Prop({ required: true, min: 0 })
  saldoDespues!: number;
}
export const LineaAjusteSchema = SchemaFactory.createForClass(LineaAjuste);

/**
 * Ajuste de inventario SC-2-16 (doc §6.6). Exige causa, autorización y firma:
 * no existe el ajuste silencioso. El documento solo se guarda cuando todas
 * sus líneas ya movieron el saldo (y escribieron su kardex).
 */
@Schema({ timestamps: true, collection: 'ajustes_inventario' })
export class AjusteInventario {
  @Prop({ required: true, unique: true })
  numeroConsecutivo!: string;

  /** robo, deterioro, error... Las disminuciones usan el nomenclador de causas. */
  @Prop({ required: true, trim: true })
  causa!: string;

  /** Quien autoriza (administrador o económico). */
  @Prop({ required: true, trim: true })
  autorizadoPor!: string;

  @Prop({ type: [LineaAjusteSchema], required: true })
  lineas!: LineaAjuste[];

  @Prop({ required: true, trim: true })
  firmadoPor!: string;

  /** Usuario logueado que registró el ajuste. */
  @Prop({ required: true, trim: true })
  registradoPor!: string;
}

export const AjusteInventarioSchema =
  SchemaFactory.createForClass(AjusteInventario);

AjusteInventarioSchema.index({ createdAt: -1 });
