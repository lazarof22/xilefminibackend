import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExistenciaDocument = HydratedDocument<Existencia>;

@Schema({ timestamps: true })
export class Existencia {
    @Prop({
        type: Types.ObjectId,
        ref: 'Producto',
        required: true,
        index: true,
    })
    producto!: Types.ObjectId;

    @Prop({
        type: Types.ObjectId,
        ref: 'Almacen',
        required: true,
        index: true,
    })
    almacen!: Types.ObjectId;

    @Prop({
        type: Types.ObjectId,
        ref: 'Contenedor',
        required: true,
        index: true,
    })
    contenedor!: Types.ObjectId;

    @Prop({
        required: true,
        min: 0,
    })
    cantidad!: number;
}

export const ExistenciaSchema = SchemaFactory.createForClass(Existencia);

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

