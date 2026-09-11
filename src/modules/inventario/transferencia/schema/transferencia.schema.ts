import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export enum TipoTransferencia {
    ENVIADA = 'enviada',
    RECIBIDA = 'recibida',
}

export type TransferenciaDocument = HydratedDocument<Transferencia>;

@Schema({ timestamps: true })
export class Transferencia {

    @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
    almacen_origen!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
    almacen_destino!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Contenedor', required: true })
    contenedor_origen!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Contenedor', required: true })
    contenedor_destino!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
    producto!: Types.ObjectId;

    @Prop({ required: true, min: 1 })
    cantidad!: number;

    @Prop({ type: Date, default: Date.now })
    fecha!: Date;

    @Prop({ required: true, enum: TipoTransferencia, default: TipoTransferencia.ENVIADA })
    tipo!: TipoTransferencia;
}

export const TransferenciaSchema = SchemaFactory.createForClass(Transferencia);
