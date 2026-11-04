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

    // Ubicación física dentro del almacén (doc §6.1). Opcionales: los
    // contenedores anteriores no la tienen.
    @Prop({ trim: true })
    seccion?: string;

    @Prop({ trim: true })
    estante?: string;

    @Prop({ trim: true })
    casilla?: string;
}

export const ContenedorSchema = SchemaFactory.createForClass(Contenedor);