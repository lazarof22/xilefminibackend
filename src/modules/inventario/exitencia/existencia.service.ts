import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import {
    Existencia,
} from './schema/existencia.schema';

import { Producto } from '../producto/schemas/producto.schema';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';

@Injectable()
export class ExistenciaService {
    constructor(
        @InjectModel(Existencia.name)
        private readonly existenciaModel: Model<Existencia>,

        @InjectModel(Producto.name)
        private readonly productoModel: Model<Producto>,

        @InjectModel(Almacen.name)
        private readonly almacenModel: Model<Almacen>,

        @InjectModel(Contenedor.name)
        private readonly contenedorModel: Model<Contenedor>,
    ) {}

    /**
     * Crear una existencia inicial.
     *
     * Se utiliza cuando se registra un producto nuevo
     * con almacén, contenedor y stock inicial.
     */
    async crearExistenciaInicial(
        productoId: Types.ObjectId,
        almacenId: string,
        contenedorId: string,
        cantidad: number,
        session?: ClientSession,
    ): Promise<Existencia> {
        if (!Types.ObjectId.isValid(almacenId)) {
            throw new BadRequestException(
                'El ID del almacén no es válido',
            );
        }

        if (!Types.ObjectId.isValid(contenedorId)) {
            throw new BadRequestException(
                'El ID del contenedor no es válido',
            );
        }

        if (cantidad < 0) {
            throw new BadRequestException(
                'La cantidad no puede ser negativa',
            );
        }

        const almacen = await this.almacenModel
            .findById(almacenId)
            .session(session ?? null);

        if (!almacen) {
            throw new NotFoundException(
                'El almacén no existe',
            );
        }

        const contenedor = await this.contenedorModel
            .findById(contenedorId)
            .session(session ?? null);

        if (!contenedor) {
            throw new NotFoundException(
                'El contenedor no existe',
            );
        }

        if (
            contenedor.almacen.toString() !==
            almacen._id.toString()
        ) {
            throw new BadRequestException(
                'El contenedor no pertenece al almacén seleccionado',
            );
        }

        const existente = await this.existenciaModel
            .findOne({
                producto: productoId,
                almacen: almacen._id,
                contenedor: contenedor._id,
            })
            .session(session ?? null);

        if (existente) {
            throw new BadRequestException(
                'Ya existe una existencia para este producto en el contenedor seleccionado',
            );
        }

        const [existencia] = await this.existenciaModel.create(
            [
                {
                    producto: productoId,
                    almacen: almacen._id,
                    contenedor: contenedor._id,
                    cantidad,
                },
            ],
            {
                session,
            },
        );

        return existencia;
    }

    /**
     * Obtener todas las ubicaciones donde existe un producto.
     */
    async listarPorProducto(
        productoId: string,
    ): Promise<Existencia[]> {
        if (!Types.ObjectId.isValid(productoId)) {
            throw new BadRequestException(
                'El ID del producto no es válido',
            );
        }

        const producto = await this.productoModel.findById(productoId);

        if (!producto) {
            throw new NotFoundException(
                'El producto no existe',
            );
        }

        return this.existenciaModel
            .find({
                producto: productoId,
                cantidad: { $gt: 0 },
            })
            .populate({
                path: 'almacen',
                select: 'nombreAlmacen',
            })
            .populate({
                path: 'contenedor',
                select: 'nombreContenedor almacen',
            })
            .populate({
                path: 'producto',
                select:
                    'codigo_producto nombre_producto categoria_producto',
            })
            .sort({
                cantidad: -1,
            })
            .exec();
    }

    /**
     * Obtener una existencia específica.
     */
    async buscarExistencia(
        productoId: string,
        almacenId: string,
        contenedorId: string,
        session?: ClientSession,
    ): Promise<Existencia> {
        const existencia = await this.existenciaModel
            .findOne({
                producto: productoId,
                almacen: almacenId,
                contenedor: contenedorId,
            })
            .session(session ?? null);

        if (!existencia) {
            throw new NotFoundException(
                'No existe inventario del producto en la ubicación indicada',
            );
        }

        return existencia;
    }

    /**
     * Aumentar cantidad en una ubicación.
     *
     * Si no existe la ubicación, se crea.
     */
    async aumentar(
        productoId: Types.ObjectId,
        almacenId: Types.ObjectId,
        contenedorId: Types.ObjectId,
        cantidad: number,
        session?: ClientSession,
    ): Promise<Existencia> {
        if (cantidad <= 0) {
            throw new BadRequestException(
                'La cantidad a aumentar debe ser mayor que cero',
            );
        }

        const existencia = await this.existenciaModel
            .findOneAndUpdate(
                {
                    producto: productoId,
                    almacen: almacenId,
                    contenedor: contenedorId,
                },
                {
                    $inc: {
                        cantidad,
                    },
                },
                {
                    new: true,
                    upsert: true,
                    setDefaultsOnInsert: true,
                    session,
                },
            )
            .exec();

        if (!existencia) {
            throw new BadRequestException(
                'No fue posible actualizar la existencia',
            );
        }

        return existencia;
    }

    /**
     * Disminuir cantidad en una ubicación.
     *
     * La condición cantidad >= cantidad solicitada se ejecuta
     * directamente en MongoDB para evitar valores negativos.
     */
    async disminuir(
        productoId: Types.ObjectId,
        almacenId: Types.ObjectId,
        contenedorId: Types.ObjectId,
        cantidad: number,
        session?: ClientSession,
    ): Promise<Existencia> {
        if (cantidad <= 0) {
            throw new BadRequestException(
                'La cantidad a disminuir debe ser mayor que cero',
            );
        }

        const existencia = await this.existenciaModel
            .findOneAndUpdate(
                {
                    producto: productoId,
                    almacen: almacenId,
                    contenedor: contenedorId,
                    cantidad: { $gte: cantidad },
                },
                {
                    $inc: {
                        cantidad: -cantidad,
                    },
                },
                {
                    new: true,
                    session,
                },
            )
            .exec();

        if (!existencia) {
            throw new BadRequestException(
                'Stock insuficiente en la ubicación de origen',
            );
        }

        return existencia;
    }
}
