import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";


export const GRAVADO_VALORES = ['gravado', 'exento'] as const;
export type Gravado = (typeof GRAVADO_VALORES)[number];

export type ProductoDocument = HydratedDocument<Producto>;

@Schema()
export class Producto {
    @Prop({ required: true, unique: true })
    codigo_producto!: string;

    @Prop({ required: true })
    nombre_producto!: string;

    @Prop({ required: true })
    categoria_producto!: string;

    @Prop({ required: true })
    precio_compra!: number;

    @Prop({ required: true })
    precio_venta!: number;

    @Prop({ required: true })
    stock_inicial!: number; //cantidad inicial

    @Prop({ required: true })
    stock_minimo!: number; // cantidad minima que debe haber

    @Prop({ required: true })
    estado!: string;

    /** Tratamiento tributario (doc §6.7). Los exentos nunca calculan impuesto. */
    @Prop({ type: String, enum: GRAVADO_VALORES, default: 'gravado' })
    gravado!: Gravado;

    @Prop({ type: Types.ObjectId, ref: 'Almacen' })
    almacen?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Contenedor' })
    contenedor?: Types.ObjectId;
}

export const ProductoSchema = SchemaFactory.createForClass(Producto);