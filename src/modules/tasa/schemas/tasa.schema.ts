import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type TasaDocument = HydratedDocument<Tasa>;

@Schema({ timestamps: true, collection: "tasas" })
export class Tasa {
    @Prop({ required: true, index: true })
    moneda!: string;

    @Prop({ required: true, min: 0 })
    tasaBancoCentral!: number;

    @Prop({ required: true, min: 0 })
    tasaMercadoInformal!: number;

    @Prop({ min: 0, default: 0 })
    iva?: number;

    @Prop({ default: true })
    activa!: boolean;

    @Prop({ type: Date, default: Date.now })
    fechaActualizacion!: Date;
}

export const TasaSchema = SchemaFactory.createForClass(Tasa);
