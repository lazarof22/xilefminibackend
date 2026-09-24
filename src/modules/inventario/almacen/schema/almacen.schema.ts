import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type AlmacenDocument = HydratedDocument<Almacen>;

@Schema({
    timestamps: true
})

export class Almacen {

    @Prop({ required: true })
    nombreAlmacen!: string;

    @Prop({ required: true, min: 0, default: 0 })
    cantidadContenedores!: number;

    // Optional (not `required`) so legacy documents created before this
    // field existed keep loading; `sparse: true` lets the unique index
    // tolerate any number of documents missing `codigo` (a `unique`-only
    // index would otherwise treat every `undefined` as the same value and
    // reject the second legacy document). New almacenes always get one via
    // CreateAlmacenDto (required there).
    @Prop({ trim: true, unique: true, sparse: true })
    codigo?: string;
}

export const AlmacenSchema = SchemaFactory.createForClass(Almacen);