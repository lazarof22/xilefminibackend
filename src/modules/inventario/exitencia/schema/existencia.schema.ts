import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExistenciaDocument = HydratedDocument<Existencia>;

@Schema({ timestamps: true })
export class Existencia {
    @Prop({
        type: Types.ObjectId,
        ref: 'Producto',
        required: true,
    })
    producto!: Types.ObjectId;

    @Prop({
        type: Types.ObjectId,
        ref: 'Almacen',
        required: true,
    })
    almacen!: Types.ObjectId;

    @Prop({
        type: Types.ObjectId,
        ref: 'Contenedor',
        required: true,
    })
    contenedor!: Types.ObjectId;

    @Prop({
        required: true,
        min: 0,
    })
    cantidad!: number;

    /** Unidades comprometidas (reservadas) que aún no han salido. */
    @Prop({
        required: true,
        min: 0,
        default: 0,
    })
    reservada!: number;

    /**
     * `disponible = cantidad - reservada`. Se mantiene SIEMPRE en la misma
     * escritura atómica que cambia `cantidad` o `reservada` (`$inc` sobre
     * ambos campos); nunca se recalcula en una segunda escritura.
     *
     * Sin `required` ni `default`: los documentos anteriores a esta fase no lo
     * tienen y `ExistenciaService.onModuleInit` los rellena. Un documento
     * nuevo lo recibe en la validación (ver el hook de abajo).
     */
    @Prop({
        min: 0,
    })
    disponible!: number;
}

export const ExistenciaSchema =
    SchemaFactory.createForClass(Existencia);

/**
 * Un documento nuevo guardado con `create`/`save` sin `disponible` lo recibe
 * derivado de `cantidad` y `reservada`.
 */
ExistenciaSchema.pre('validate', function () {
    if (this.disponible === undefined || this.disponible === null) {
        this.disponible = this.cantidad - (this.reservada ?? 0);
    }
});

/**
 * Una combinación producto + almacén + contenedor
 * representa una única existencia física.
 *
 * No puede haber dos documentos para la misma ubicación.
 */
ExistenciaSchema.index(
    {
        producto: 1,
        almacen: 1,
        contenedor: 1,
    },
    {
        unique: true,
        name: 'producto_almacen_contenedor_unique',
    },
);

/**
 * Índice para consultas frecuentes:
 * obtener todas las ubicaciones de un producto.
 */
ExistenciaSchema.index({
    producto: 1,
});

/**
 * Índice para consultas por almacén.
 */
ExistenciaSchema.index({
    almacen: 1,
});

