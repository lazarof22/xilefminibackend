import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RegistroCompraDocument = HydratedDocument<RegistroCompra>;

/**
 * Compra de inventario registrada desde Movimientos > Registrar Compra.
 *
 * Guarda los datos del formulario: qué producto se compró, en qué
 * almacén y contenedor quedó, cuánto y a qué costo.
 *
 * No confundir con el módulo `compra` (compras a proveedor con moneda,
 * empresa, modo de pago, cuentas por pagar y comprobantes contables).
 */
@Schema({ timestamps: true })
export class RegistroCompra {
    @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
    producto!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
    almacen!: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Contenedor', required: true })
    contenedor!: Types.ObjectId;

    @Prop({ required: true, min: 1 })
    cantidad!: number;

    @Prop({ required: true, min: 0 })
    costo_unitario!: number;

    /** cantidad × costo_unitario. Lo calcula el servidor, no el cliente. */
    @Prop({ required: true, min: 0 })
    total!: number;

    @Prop({ type: Date, default: Date.now })
    fecha!: Date;
}

export const RegistroCompraSchema =
    SchemaFactory.createForClass(RegistroCompra);

// Consultas habituales: historial por producto y por fecha.
RegistroCompraSchema.index({ producto: 1, fecha: -1 });
