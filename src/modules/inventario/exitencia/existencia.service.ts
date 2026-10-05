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

/** Error E11000 de MongoDB (violación del índice único). */
const esClaveDuplicada = (err: unknown): boolean =>
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000;

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
     *
     * Solo devuelve filas con cantidad > 0 y con almacén y contenedor
     * poblados (nombre), listas para los selectores de Transferencias.
     */
    async listarPorProducto(
        productoId: string,
    ): Promise<Existencia[]> {
        if (!Types.ObjectId.isValid(productoId)) {
            throw new BadRequestException(
                'El ID del producto no es válido',
            );
        }

        // lean(): solo se necesitan los datos, no el documento hidratado.
        const producto = await this.productoModel
            .findById(productoId)
            .select('almacen contenedor stock_inicial')
            .lean()
            .exec();

        if (!producto) {
            throw new NotFoundException(
                'El producto no existe',
            );
        }

        await this.sincronizarUbicacionInicial(producto);

        // No se puebla `producto`: quien llama ya lo conoce, y cada
        // populate es una consulta extra a la base de datos.
        return this.existenciaModel
            .find({
                producto: producto._id,
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
            .sort({
                cantidad: -1,
            })
            .lean()
            .exec();
    }

    /**
     * Productos creados antes de que existiera la colección `existencias`
     * guardan su ubicación solo en el propio producto (`almacen` +
     * `contenedor`) y su stock en `stock_inicial`, por lo que no aparecían
     * como transferibles. Aquí se crea la fila que les falta.
     *
     * - Solo actúa si el producto NO tiene ninguna fila de existencias (ni
     *   siquiera con cantidad 0), para no "resucitar" stock de un producto
     *   que ya se agotó por transferencias.
     * - Solo usa la ubicación del producto si el contenedor existe y
     *   pertenece a ese almacén.
     * - Es idempotente y segura ante peticiones simultáneas: usa upsert con
     *   $setOnInsert y el índice único (producto, almacén, contenedor).
     */
    private async sincronizarUbicacionInicial(producto: {
        _id: Types.ObjectId;
        almacen?: Types.ObjectId;
        contenedor?: Types.ObjectId;
        stock_inicial?: number;
    }): Promise<void> {
        if (!producto.almacen || !producto.contenedor) {
            return;
        }

        const yaTieneExistencias = await this.existenciaModel.exists({
            producto: producto._id,
        });

        if (yaTieneExistencias) {
            return;
        }

        const contenedorValido = await this.contenedorModel
            .exists({
                _id: producto.contenedor,
                almacen: producto.almacen,
            });

        if (!contenedorValido) {
            return;
        }

        const cantidad = Math.max(
            0,
            Number(producto.stock_inicial) || 0,
        );

        try {
            await this.existenciaModel.updateOne(
                {
                    producto: producto._id,
                    almacen: producto.almacen,
                    contenedor: producto.contenedor,
                },
                { $setOnInsert: { cantidad } },
                { upsert: true },
            );
        } catch (error) {
            // Otra petición la creó a la vez: el resultado es el mismo.
            if (!esClaveDuplicada(error)) {
                throw error;
            }
        }
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