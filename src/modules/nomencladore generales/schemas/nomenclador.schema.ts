import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NomencladorDocument = HydratedDocument<Nomenclador>;

@Schema({
    timestamps: true,
    collection: 'nomencladores',
})
export class Nomenclador {
    @Prop({ required: true, unique: true, trim: true, uppercase: true, })
    codigo!: string;

    @Prop({ required: true, trim: true, })
    nombre!: string;

    @Prop({
        trim: true,
        default: '',
    })
    descripcion!: string;

    @Prop({
        default: true,
    })
    activo!: boolean;

    @Prop({
        default: 0,
    })
    orden!: number;

    @Prop({
        default: false,
    })
    esSistema!: boolean;
}

export const NomencladorSchema = SchemaFactory.createForClass(Nomenclador);