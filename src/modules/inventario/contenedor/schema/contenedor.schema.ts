import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type ContenedorDocument = HydratedDocument<Contenedor>;

@Schema({
    timestamps: true
})

export class Contenedor {

    @Prop({ required: true, unique: true })
    codigoContenedor!: string;

    @Prop({ required: true })
    nombreContenedor!: string;

    @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
    almacen!: Types.ObjectId;
}

export const ContenedorSchema = SchemaFactory.createForClass(Contenedor);