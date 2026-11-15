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

    /**
     * SC-2-09. Correlative number (`TRF-000001`). Sparse unique: transfers
     * stored before this field existed have none.
     */
    @Prop({ trim: true, index: { unique: true, sparse: true } })
    numeroConsecutivo!: string;

    /** SC-2-09 signatures. Not required at schema level so older documents stay valid. */
    @Prop({ trim: true })
    autorizadoPor!: string;

    @Prop({ trim: true })
    entregadoPor!: string;

    @Prop({ trim: true })
    recibidoPor!: string;
}

export const TransferenciaSchema = SchemaFactory.createForClass(Transferencia);
