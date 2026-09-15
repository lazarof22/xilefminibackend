import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NomencladorValorDocument = HydratedDocument<NomencladorValor>;

@Schema({
    timestamps: true,
    collection: 'nomencladores_valores',
})
export class NomencladorValor {
    @Prop({ type: Types.ObjectId, ref: 'Nomenclador', required: true, index: true, })
    nomencladorId!: Types.ObjectId;

    @Prop({
        required: true,
        trim: true,
        uppercase: true,
    })
    codigo!: string;

    @Prop({
        required: true,
        trim: true,
    })
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
}

export const NomencladorValorSchema =
    SchemaFactory.createForClass(NomencladorValor);

NomencladorValorSchema.index(
    {
        nomencladorId: 1,
        codigo: 1,
    },
    {
        unique: true,
    },
);