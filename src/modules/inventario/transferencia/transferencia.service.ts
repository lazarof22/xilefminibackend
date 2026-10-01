import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';

import {
    ClientSession,
    Connection,
    Model,
    Types,
} from 'mongoose';

import { InjectConnection } from '@nestjs/mongoose';

import { CreateTransferenciaDto } from './dto/create-transferencia.dto';
import { UpdateTransferenciaDto } from './dto/update-transferencia.dto';

import {
    Transferencia,
    TipoTransferencia,
} from './schema/transferencia.schema';

import {
    Almacen,
} from '../almacen/schema/almacen.schema';

import {
    Contenedor,
} from '../contenedor/schema/contenedor.schema';

import {
    Producto,
} from '../producto/schemas/producto.schema';

import {
    Kardex,
    KardexTipo,
} from '../kardex/schema/kardex.schema';

import {
    Existencia,
} from '../exitencia/schema/existencia.schema';

@Injectable()
export class TransferenciaService {
    constructor(
        @InjectModel(Transferencia.name)
        private readonly transferenciaModel: Model<Transferencia>,

        @InjectModel(Almacen.name)
        private readonly almacenModel: Model<Almacen>,

        @InjectModel(Contenedor.name)
        private readonly contenedorModel: Model<Contenedor>,

        @InjectModel(Producto.name)
        private readonly productoModel: Model<Producto>,

        @InjectModel(Kardex.name)
        private readonly kardexModel: Model<Kardex>,

        @InjectModel(Existencia.name)
        private readonly existenciaModel: Model<Existencia>,

        @InjectConnection()
        private readonly connection: Connection,
    ) {}

    async create(
        createTransferenciaDto: CreateTransferenciaDto,
    ): Promise<Transferencia> {
        const {
            almacen_origen,
            almacen_destino,
            contenedor_origen,
            contenedor_destino,
            producto,
            cantidad,
        } = createTransferenciaDto;

        if (
            !Types.ObjectId.isValid(almacen_origen) ||
            !Types.ObjectId.isValid(almacen_destino)
        ) {
            throw new BadRequestException(
                'Los almacenes indicados no son válidos',
            );
        }

        if (
            !Types.ObjectId.isValid(contenedor_origen) ||
            !Types.ObjectId.isValid(contenedor_destino)
        ) {
            throw new BadRequestException(
                'Los contenedores indicados no son válidos',
            );
        }

        if (!Types.ObjectId.isValid(producto)) {
            throw new BadRequestException(
                'El ID del producto no es válido',
            );
        }

        if (cantidad <= 0) {
            throw new BadRequestException(
                'La cantidad debe ser mayor que cero',
            );
        }

        if (
            almacen_origen === almacen_destino &&
            contenedor_origen === contenedor_destino
        ) {
            throw new BadRequestException(
                'El origen y destino no pueden ser la misma ubicación',
            );
        }

        const session =
            await this.connection.startSession();

        try {
            type TransferenciaConId = Transferencia & {
                _id: Types.ObjectId;
            };

            let transferenciaGuardada:
                | TransferenciaConId
                | null = null;

            await session.withTransaction(
                async () => {
                    const almacenOrigen =
                        await this.almacenModel
                            .findById(almacen_origen)
                            .session(session);

                    if (!almacenOrigen) {
                        throw new NotFoundException(
                            'El almacén de origen no existe',
                        );
                    }

                    const almacenDestino =
                        await this.almacenModel
                            .findById(almacen_destino)
                            .session(session);

                    if (!almacenDestino) {
                        throw new NotFoundException(
                            'El almacén de destino no existe',
                        );
                    }

                    const contenedorOrigen =
                        await this.contenedorModel
                            .findById(contenedor_origen)
                            .session(session);

                    if (!contenedorOrigen) {
                        throw new NotFoundException(
                            'El contenedor de origen no existe',
                        );
                    }

                    const contenedorDestino =
                        await this.contenedorModel
                            .findById(contenedor_destino)
                            .session(session);

                    if (!contenedorDestino) {
                        throw new NotFoundException(
                            'El contenedor de destino no existe',
                        );
                    }

                    // Validar pertenencia de contenedores
                    if (
                        contenedorOrigen.almacen.toString() !==
                        almacenOrigen._id.toString()
                    ) {
                        throw new BadRequestException(
                            'El contenedor de origen no pertenece al almacén de origen',
                        );
                    }

                    if (
                        contenedorDestino.almacen.toString() !==
                        almacenDestino._id.toString()
                    ) {
                        throw new BadRequestException(
                            'El contenedor de destino no pertenece al almacén de destino',
                        );
                    }

                    const productoExist =
                        await this.productoModel
                            .findById(producto)
                            .session(session);

                    if (!productoExist) {
                        throw new NotFoundException(
                            'El producto no existe',
                        );
                    }

                    /**
                     * Buscar la existencia física exacta
                     * del producto en el origen.
                     */
                    const existenciaOrigen =
                        await this.existenciaModel
                            .findOne({
                                producto:
                                    productoExist._id,
                                almacen: almacenOrigen._id,
                                contenedor:
                                    contenedorOrigen._id,
                                cantidad: {
                                    $gte: cantidad,
                                },
                            })
                            .session(session);

                    if (!existenciaOrigen) {
                        const existenciaReal =
                            await this.existenciaModel
                                .findOne({
                                    producto:
                                        productoExist._id,
                                    almacen:
                                        almacenOrigen._id,
                                    contenedor:
                                        contenedorOrigen._id,
                                })
                                .session(session);

                        if (!existenciaReal) {
                            throw new BadRequestException(
                                'El producto no existe en la ubicación de origen',
                            );
                        }

                        throw new BadRequestException(
                            `Stock insuficiente en origen. Disponible: ${existenciaReal.cantidad}`,
                        );
                    }

                    /**
                     * RESTAR DEL ORIGEN
                     */
                    existenciaOrigen.cantidad -= cantidad;

                    await existenciaOrigen.save({
                        session,
                    });

                    /**
                     * Si queda en cero, conservamos el documento
                     * para mantener trazabilidad de la ubicación.
                     *
                     * Las consultas de disponibilidad solamente
                     * muestran cantidad > 0.
                     */

                    /**
                     * SUMAR AL DESTINO
                     *
                     * Si ya existe la combinación:
                     * producto + almacén + contenedor
                     * se incrementa.
                     *
                     * Si no existe, se crea.
                     */
                    let existenciaDestino =
                        await this.existenciaModel
                            .findOne({
                                producto:
                                    productoExist._id,
                                almacen: almacenDestino._id,
                                contenedor:
                                    contenedorDestino._id,
                            })
                            .session(session);

                    if (existenciaDestino) {
                        existenciaDestino.cantidad += cantidad;

                        await existenciaDestino.save({
                            session,
                        });
                    } else {
                        const nuevasExistencias =
                            await this.existenciaModel.create(
                                [
                                    {
                                        producto:
                                            productoExist._id,
                                        almacen:
                                            almacenDestino._id,
                                        contenedor:
                                            contenedorDestino._id,
                                        cantidad,
                                    },
                                ],
                                {
                                    session,
                                },
                            );

                        existenciaDestino =
                            nuevasExistencias[0];
                    }

                    /**
                     * Registrar transferencia.
                     */
                    const nuevasTransferencias =
                        await this.transferenciaModel.create(
                            [
                                {
                                    ...createTransferenciaDto,
                                    tipo:
                                        createTransferenciaDto.tipo ??
                                        TipoTransferencia.ENVIADA,
                                },
                            ],
                            {
                                session,
                            },
                        );

                    transferenciaGuardada =
                        nuevasTransferencias[0];

                    /**
                     * Kardex de salida.
                     */
                    await this.kardexModel.create(
                        [
                            {
                                productoId:
                                    productoExist._id,
                                tipo:
                                    KardexTipo.TRANSFERENCIA_SALIDA,
                                cantidad,
                                stock:
                                    existenciaOrigen.cantidad,
                                motivo:
                                    `Transferencia desde ${almacenOrigen.nombreAlmacen}`,
                                referencia:
                                    transferenciaGuardada._id.toString(),
                            },
                        ],
                        {
                            session,
                        },
                    );

                    /**
                     * Kardex de entrada.
                     */
                    await this.kardexModel.create(
                        [
                            {
                                productoId:
                                    productoExist._id,
                                tipo:
                                    KardexTipo.TRANSFERENCIA_ENTRADA,
                                cantidad,
                                stock:
                                    existenciaDestino.cantidad,
                                motivo:
                                    `Transferencia hacia ${almacenDestino.nombreAlmacen}`,
                                referencia:
                                    transferenciaGuardada._id.toString(),
                            },
                        ],
                        {
                            session,
                        },
                    );
                },
                {
                    readPreference: 'primary',
                },
            );

            if (!transferenciaGuardada) {
                throw new BadRequestException(
                    'No fue posible registrar la transferencia',
                );
            }

            return transferenciaGuardada;
        } finally {
            await session.endSession();
        }
    }

    async findAll(): Promise<Transferencia[]> {
        return this.transferenciaModel
            .find()
            .populate({
                path: 'almacen_origen',
                select: 'nombreAlmacen',
            })
            .populate({
                path: 'almacen_destino',
                select: 'nombreAlmacen',
            })
            .populate({
                path: 'contenedor_origen',
                select: 'nombreContenedor',
            })
            .populate({
                path: 'contenedor_destino',
                select: 'nombreContenedor',
            })
            .populate({
                path: 'producto',
                select:
                    'nombre_producto codigo_producto',
            })
            .sort({
                createdAt: -1,
            })
            .exec();
    }

    async findOne(
        id: string,
    ): Promise<Transferencia> {
        const transferencia =
            await this.transferenciaModel
                .findById(id)
                .populate({
                    path: 'almacen_origen',
                    select: 'nombreAlmacen',
                })
                .populate({
                    path: 'almacen_destino',
                    select: 'nombreAlmacen',
                })
                .populate({
                    path: 'contenedor_origen',
                    select: 'nombreContenedor',
                })
                .populate({
                    path: 'contenedor_destino',
                    select: 'nombreContenedor',
                })
                .populate({
                    path: 'producto',
                    select:
                        'nombre_producto codigo_producto',
                })
                .exec();

        if (!transferencia) {
            throw new NotFoundException(
                'No se encontró la transferencia',
            );
        }

        return transferencia;
    }

    async update(
        id: string,
        updateTransferenciaDto: UpdateTransferenciaDto,
    ): Promise<Transferencia> {
        throw new BadRequestException(
            'Las transferencias no pueden modificarse después de ejecutadas. Registre una nueva transferencia para corregir el movimiento.',
        );
    }

    async remove(id: string): Promise<void> {
        throw new BadRequestException(
            'Las transferencias ejecutadas no pueden eliminarse. Para corregir un movimiento debe registrarse una transferencia inversa.',
        );
    }
}

