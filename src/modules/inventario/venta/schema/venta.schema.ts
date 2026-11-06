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

    // ── Lo que calculó el servidor en el checkout (Fase 2); ausente en ventas anteriores ──

    @Prop()
    codigo?: string;

    @Prop()
    nombre?: string;

    @Prop()
    precioUnitario?: number;

    @Prop()
    descuentoPct?: number;

    /** Precio × cantidad, antes del descuento. */
    @Prop()
    subtotal?: number;

    @Prop()
    impuesto?: number;

    /** Lo que se cobra por la línea: subtotal − descuento + impuesto. */
    @Prop()
    total?: number;

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

    // ── Fase 2 (checkout): ausentes en las ventas registradas con POST /venta ──

    /** Número correlativo del comprobante simplificado del POS (V-000123). */
    @Prop({ index: true })
    comprobante?: string;

    @Prop({ type: Types.ObjectId, ref: 'Cliente' })
    clienteId?: Types.ObjectId;

    @Prop()
    clienteNombre?: string;

    /** Quién cobró (nombre del usuario). */
    @Prop()
    usuario?: string;

    /** Clave de idempotencia (`Idempotency-Key`) con la que se registró. */
    @Prop()
    operacion?: string;

    /** Impuesto aplicado (%), tal como estaba al vender. */
    @Prop()
    impuestoPorciento?: number;

    /** Total cobrado: subtotal − descuento + impuesto. */
    @Prop()
    total?: number;

}

export const VentaSchema = SchemaFactory.createForClass(Venta);