import {
    Injectable,
    Logger,
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

import { ExistenciaService } from '../exitencia/existencia.service';

@Injectable()
export class TransferenciaService {
    private readonly logger = new Logger(TransferenciaService.name);

    /** null = aún no se ha comprobado. Solo se guarda un resultado fiable. */
    private transaccionesSoportadas: boolean | null = null;

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

        private readonly existenciaService: ExistenciaService,
    ) { }

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

        /**
         * Las transacciones de MongoDB solo existen en un replica set
         * (o mongos). En un MongoDB independiente —lo habitual en
         * desarrollo local— darían "Transaction numbers are only allowed
         * on a replica set member or mongos".
         *
         * - Con soporte: todo ocurre dentro de una transacción real.
         * - Sin soporte: las mismas operaciones se ejecutan sin sesión,
         *   cada una atómica por documento, y si algo falla a mitad se
         *   deshace lo ya hecho (ver ejecutarTransferencia).
         */
        if (await this.soportaTransacciones()) {
            return this.connection.transaction(
                (session) =>
                    this.ejecutarTransferencia(
                        createTransferenciaDto,
                        session,
                    ),
                { readPreference: 'primary' },
            );
        }

        return this.ejecutarTransferencia(createTransferenciaDto);
    }

    /**
     * Indica si el servidor admite transacciones (replica set o mongos).
     * Si no se puede determinar, devuelve false (camino seguro) sin
     * guardar el resultado, para volver a comprobarlo en la próxima.
     */
    private async soportaTransacciones(): Promise<boolean> {
        if (this.transaccionesSoportadas !== null) {
            return this.transaccionesSoportadas;
        }

        const admin = this.connection.db?.admin();

        if (!admin) {
            return false;
        }

        let info: Record<string, unknown>;

        try {
            info = await admin.command({ hello: 1 });
        } catch {
            try {
                // Servidores anteriores a 4.4.2 no conocen "hello".
                info = await admin.command({ isMaster: 1 });
            } catch (error) {
                this.logger.warn(
                    `No se pudo comprobar si MongoDB admite transacciones: ${String(error)}`,
                );
                return false;
            }
        }

        this.transaccionesSoportadas =
            Boolean(info.setName) || info.msg === 'isdbgrid';

        if (!this.transaccionesSoportadas) {
            this.logger.warn(
                'MongoDB no está en modo replica set: las transferencias se ' +
                'ejecutan sin transacción (con reversión manual si fallan).',
            );
        }

        return this.transaccionesSoportadas;
    }

    /**
     * Ejecuta la transferencia.
     *
     * Con `session` (transacción) cualquier error la aborta completa.
     * Sin `session`, cada paso se registra en `deshacer` y, si un paso
     * posterior falla, se revierten en orden inverso.
     *
     * El descuento del origen usa una condición atómica
     * (`cantidad >= N`), por lo que dos transferencias simultáneas nunca
     * pueden dejar el stock en negativo.
     */
    private async ejecutarTransferencia(
        dto: CreateTransferenciaDto,
        session?: ClientSession,
    ): Promise<Transferencia> {
        const deshacer: Array<() => Promise<unknown>> = [];

        try {
            const {
                almacen_origen,
                almacen_destino,
                contenedor_origen,
                contenedor_destino,
                producto,
                cantidad,
            } = dto;

            const ses = session ?? null;

            // Una consulta por colección en lugar de dos.
            const almacenes = await this.almacenModel
                .find({ _id: { $in: [almacen_origen, almacen_destino] } })
                .session(ses);

            const almacenOrigen = almacenes.find(
                (a) => a._id.toString() === almacen_origen,
            );
            const almacenDestino = almacenes.find(
                (a) => a._id.toString() === almacen_destino,
            );

            if (!almacenOrigen) {
                throw new NotFoundException(
                    'El almacén de origen no existe',
                );
            }

            if (!almacenDestino) {
                throw new NotFoundException(
                    'El almacén de destino no existe',
                );
            }

            const contenedores = await this.contenedorModel
                .find({
                    _id: { $in: [contenedor_origen, contenedor_destino] },
                })
                .session(ses);

            const contenedorOrigen = contenedores.find(
                (c) => c._id.toString() === contenedor_origen,
            );
            const contenedorDestino = contenedores.find(
                (c) => c._id.toString() === contenedor_destino,
            );

            if (!contenedorOrigen) {
                throw new NotFoundException(
                    'El contenedor de origen no existe',
                );
            }

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

            const productoExist = await this.productoModel
                .findById(producto)
                .session(ses);

            if (!productoExist) {
                throw new NotFoundException('El producto no existe');
            }

            /**
             * REBAJAR DEL ORIGEN (almacén + contenedor exactos).
             * Falla sin tocar nada si no hay stock suficiente.
             */
            let existenciaOrigen: Existencia;

            try {
                existenciaOrigen = await this.existenciaService.disminuir(
                    productoExist._id,
                    almacenOrigen._id,
                    contenedorOrigen._id,
                    cantidad,
                    session,
                );
            } catch (error) {
                if (error instanceof BadRequestException) {
                    throw await this.errorDeStock(
                        productoExist._id,
                        almacenOrigen._id,
                        contenedorOrigen._id,
                        session,
                    );
                }

                throw error;
            }

            deshacer.push(() =>
                this.existenciaService.aumentar(
                    productoExist._id,
                    almacenOrigen._id,
                    contenedorOrigen._id,
                    cantidad,
                ),
            );

            /**
             * SUMAR AL DESTINO (se crea la existencia si no existe).
             */
            const existenciaDestino = await this.existenciaService.aumentar(
                productoExist._id,
                almacenDestino._id,
                contenedorDestino._id,
                cantidad,
                session,
            );

            deshacer.push(() =>
                this.existenciaService.disminuir(
                    productoExist._id,
                    almacenDestino._id,
                    contenedorDestino._id,
                    cantidad,
                ),
            );

            /**
             * Registrar la transferencia.
             */
            const [transferenciaGuardada] =
                await this.transferenciaModel.create(
                    [
                        {
                            ...dto,
                            tipo: dto.tipo ?? TipoTransferencia.ENVIADA,
                        },
                    ],
                    { session },
                );

            deshacer.push(() =>
                this.transferenciaModel.deleteOne({
                    _id: transferenciaGuardada._id,
                }),
            );

            /**
             * Kardex: salida del origen y entrada al destino.
             */
            const referencia = transferenciaGuardada._id.toString();

            await this.kardexModel.create(
                [
                    {
                        productoId: productoExist._id,
                        tipo: KardexTipo.TRANSFERENCIA_SALIDA,
                        cantidad,
                        stock: existenciaOrigen.cantidad,
                        motivo: `Transferencia desde ${almacenOrigen.nombreAlmacen}`,
                        referencia,
                    },
                    {
                        productoId: productoExist._id,
                        tipo: KardexTipo.TRANSFERENCIA_ENTRADA,
                        cantidad,
                        stock: existenciaDestino.cantidad,
                        motivo: `Transferencia hacia ${almacenDestino.nombreAlmacen}`,
                        referencia,
                    },
                ],
                { session, ordered: true },
            );

            return transferenciaGuardada;
        } catch (error) {
            // En una transacción, el rollback lo hace MongoDB.
            if (!session) {
                await this.revertir(deshacer);
            }

            throw error;
        }
    }

    /**
     * Deshace, en orden inverso, los pasos ya aplicados cuando no hay
     * transacción. Un fallo al revertir se registra pero no oculta el
     * error original que causó la reversión.
     */
    private async revertir(
        deshacer: Array<() => Promise<unknown>>,
    ): Promise<void> {
        for (const paso of [...deshacer].reverse()) {
            try {
                await paso();
            } catch (error) {
                this.logger.error(
                    `No se pudo revertir un paso de la transferencia: ${String(error)}`,
                );
            }
        }
    }

    /**
     * Mensaje claro cuando falla el descuento del origen: distingue
     * "no hay existencia ahí" de "no alcanza", e indica lo disponible.
     */
    private async errorDeStock(
        productoId: Types.ObjectId,
        almacenId: Types.ObjectId,
        contenedorId: Types.ObjectId,
        session?: ClientSession,
    ): Promise<BadRequestException> {
        const existenciaReal = await this.existenciaModel
            .findOne({
                producto: productoId,
                almacen: almacenId,
                contenedor: contenedorId,
            })
            .session(session ?? null);

        if (!existenciaReal) {
            return new BadRequestException(
                'El producto no existe en la ubicación de origen',
            );
        }

        return new BadRequestException(
            `Stock insuficiente en origen. Disponible: ${existenciaReal.cantidad}`,
        );
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