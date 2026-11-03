import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";


export type VentaDocument = HydratedDocument<Venta>;



/** De qué ubicación salió parte de una línea (solo en modo unificado). */
@Schema({ _id: false })
class UbicacionVenta {
    @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
    almacen!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Contenedor', required: true })
    contenedor!: Types.ObjectId;

    @Prop({ required: true })
    cantidad!: number;
}

@Schema()
class ItemVenta {
    @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
    productoId!: Types.ObjectId;

    @Prop({ required: true })
    cantidad!: number;

    @Prop({ default: 0 })
    descuentoMonto!: number;

    /** Ubicaciones de las que se descontó la línea; ausente en ventas anteriores a la Fase 1. */
    @Prop({ type: [UbicacionVenta], default: undefined })
    ubicaciones?: UbicacionVenta[];

}



@Schema({ timestamps: true })
export class Venta {

    @Prop({ required: true })
    subtotal_venta!: number;

    @Prop({ required: true })
    descuento_total!: number;

    @Prop({ type: [ItemVenta], required: true })
    productos!: ItemVenta[];

    @Prop({ required: true })
    impuesto!: number;

    @Prop({ required: true,type: Types.ObjectId, ref: 'Pago' })
    pago!: Types.ObjectId;

}

export const VentaSchema = SchemaFactory.createForClass(Venta);