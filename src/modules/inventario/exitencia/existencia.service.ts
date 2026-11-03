import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import {
    Existencia,
} from './schema/existencia.schema';
import {
    CLAVE_CONFIG_INVENTARIO,
    ConfiguracionInventario,
} from './schema/configuracion-inventario.schema';
import {
    AsignacionDescuento,
    EPSILON,
    FilaExistencia,
    ResultadoMovimiento,
    ResultadoNormalizacion,
    TOLERANCIA_SALDO,
    UbicacionCantidad,
    aObjectId,
    ambosTipos,
    esIdEnTexto,
    redondear,
} from './existencia.types';
import {
    fusionarUbicaciones,
    planificarDescuento,
} from './existencia-asignacion';
import { StockInsuficienteException } from './stock-insuficiente.exception';

import { Producto } from '../producto/schemas/producto.schema';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';

/** Veces que se relee y reparte un descuento si otro movimiento vació una fila a la vez. */
const MAX_INTENTOS_DESCUENTO = 5;

/** Veces que se reintenta si otro movimiento creó a la vez la fila de una ubicación nueva. */
const MAX_INTENTOS_FILA_NUEVA = 3;

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

        @InjectModel(ConfiguracionInventario.name)
        private readonly configModel: Model<ConfiguracionInventario>,
    ) {}

    private readonly logger = new Logger(ExistenciaService.name);

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
        almacen?: Types.ObjectId | string;
        contenedor?: Types.ObjectId | string;
        stock_inicial?: number;
    }): Promise<void> {
        // El producto guarda su ubicación con el texto del formulario (o como
        // ObjectId, según cómo se creó); la fila de existencias se crea SIEMPRE
        // con ObjectId. Con texto, la transferencia (que busca con ObjectId) no
        // encontraría el stock de esta fila.
        const almacen = aObjectId(producto.almacen);
        const contenedor = aObjectId(producto.contenedor);

        if (!almacen || !contenedor) {
            return;
        }

        const yaTieneExistencias = await this.existenciaModel.exists({
            producto: { $in: ambosTipos(producto._id) },
        });

        if (yaTieneExistencias) {
            return;
        }

        const contenedorValido = await this.contenedorModel
            .exists({
                _id: contenedor,
                almacen: { $in: ambosTipos(almacen) },
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
                    almacen,
                    contenedor,
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

    // ════════════════════════════════════════════════════════════════
    //  FASE 1 — EXISTENCIA COMO ÚNICA FUENTE DEL SALDO OPERATIVO
    //
    //  El saldo real de un producto vive en `Existencia` (producto +
    //  almacén + contenedor). `Producto.stock_inicial` se conserva como
    //  total sincronizado (Σ existencias) para los módulos que ya lo leen
    //  (IPV, reporte de inventario, catálogo), pero deja de ser la fuente
    //  de verdad. Se actualiza SIEMPRE con `$inc` del mismo delta, que
    //  conmuta: dos movimientos simultáneos nunca se pisan.
    //
    //  MongoDB corre sin réplica (no hay transacciones): cada escritura es
    //  atómica por documento y, si algo falla a mitad, se compensa lo ya
    //  aplicado. Una escritura que lanza error (timeout, red) es ambigua:
    //  puede haberse aplicado o no; no se compensa a ciegas, se registra en
    //  el log y el reporte de conciliación detecta cualquier desfase.
    // ════════════════════════════════════════════════════════════════

    /** Estado de la compuerta de unificación. */
    async obtenerEstadoUnificacion(): Promise<{
        unificado: boolean;
        unificadoEn?: Date;
        unificadoPor?: string;
    }> {
        const config = await this.configModel
            .findOne({ clave: CLAVE_CONFIG_INVENTARIO })
            .lean()
            .exec();

        return {
            unificado: config?.existenciasUnificadas === true,
            unificadoEn: config?.unificadoEn,
            unificadoPor: config?.unificadoPor,
        };
    }

    /**
     * ¿Está activo el modo unificado? Mientras no lo esté, venta, factura y
     * ajustes se comportan como antes (descuentan `Producto.stock_inicial`).
     * Se consulta en cada operación a propósito: una lectura por `clave`
     * indexada es barata y evita que otra instancia siga con el modo viejo.
     */
    async estaUnificado(): Promise<boolean> {
        const config = await this.configModel
            .findOne({ clave: CLAVE_CONFIG_INVENTARIO })
            .select('existenciasUnificadas')
            .lean()
            .exec();

        return config?.existenciasUnificadas === true;
    }

    /** Activa el modo unificado (la conciliación comprueba antes que no haya diferencias). */
    async activarModoUnificado(
        usuario: string,
    ): Promise<{ unificadoEn?: Date; unificadoPor?: string }> {
        const config = await this.configModel
            .findOneAndUpdate(
                { clave: CLAVE_CONFIG_INVENTARIO },
                {
                    $set: {
                        existenciasUnificadas: true,
                        unificadoEn: new Date(),
                        unificadoPor: usuario,
                    },
                },
                {
                    upsert: true,
                    returnDocument: 'after',
                    setDefaultsOnInsert: true,
                },
            )
            .lean()
            .exec();

        return {
            unificadoEn: config?.unificadoEn,
            unificadoPor: config?.unificadoPor,
        };
    }

    /**
     * Descuenta stock de un producto repartiéndolo entre sus ubicaciones.
     *
     * - Sin `almacenId`/`contenedorId`: política por defecto (primero la
     *   ubicación por defecto del producto, luego la de más stock).
     * - Con ellos: solo se toma de esa ubicación (o de ese almacén).
     *
     * Cada fila se descuenta con una condición atómica (`cantidad >= n`):
     * dos cajeros que venden la última unidad a la vez nunca la venden dos
     * veces. Si otro movimiento vacía una fila entre la lectura y la
     * escritura, se relee y se reparte lo que falta (hasta 5 intentos).
     * Si al final no alcanza, se deshace lo aplicado y se lanza
     * `StockInsuficienteException`.
     */
    async descontarProducto(opts: {
        productoId: string | Types.ObjectId;
        cantidad: number;
        almacenId?: string | Types.ObjectId;
        contenedorId?: string | Types.ObjectId;
    }): Promise<ResultadoMovimiento> {
        const productoId = this.comoObjectId(
            opts.productoId,
            'El ID del producto no es válido',
        );
        const cantidad = this.cantidadValida(opts.cantidad);

        const producto = await this.productoModel
            .findById(productoId)
            .select('nombre_producto almacen contenedor')
            .lean()
            .exec();

        if (!producto) {
            throw new NotFoundException('El producto no existe');
        }

        const nombre = `"${producto.nombre_producto}"`;
        const ubicacionTexto =
            opts.almacenId || opts.contenedorId
                ? 'en la ubicación indicada'
                : undefined;
        const filtro = this.filtroFilas(
            productoId,
            opts.almacenId,
            opts.contenedorId,
        );
        const aplicadas: AsignacionDescuento[] = [];
        let pendiente = cantidad;

        try {
            for (
                let intento = 0;
                intento < MAX_INTENTOS_DESCUENTO && pendiente > EPSILON;
                intento++
            ) {
                const filas = await this.leerFilasConStock(filtro);

                if (intento === 0) {
                    const disponible = this.sumar(filas);
                    if (disponible + EPSILON < cantidad) {
                        throw new StockInsuficienteException(
                            nombre,
                            disponible,
                            cantidad,
                            ubicacionTexto,
                        );
                    }
                }

                const plan = planificarDescuento(filas, pendiente, producto);

                if (plan.asignaciones.length === 0) {
                    break;
                }

                for (const asignacion of plan.asignaciones) {
                    if (await this.decrementarFila(asignacion)) {
                        aplicadas.push(asignacion);
                        pendiente = redondear(pendiente - asignacion.cantidad);
                    }
                }
            }

            if (pendiente > EPSILON) {
                // Otros movimientos consumieron el stock mientras se repartía.
                // Primero se devuelve lo ya descontado, para que el mensaje
                // diga lo que de verdad hay disponible.
                await this.compensarDescuento(aplicadas);
                aplicadas.length = 0;

                const disponible = this.sumar(await this.leerFilasConStock(filtro));
                throw new StockInsuficienteException(
                    nombre,
                    disponible,
                    cantidad,
                    ubicacionTexto,
                );
            }

            const stockTotal = await this.moverCacheProducto(
                productoId,
                -cantidad,
            );

            return {
                ubicaciones: fusionarUbicaciones(aplicadas),
                stockTotal,
            };
        } catch (error) {
            await this.compensarDescuento(aplicadas);
            throw error;
        }
    }

    /**
     * Repone stock de un producto.
     *
     * - Con `ubicaciones`: reversión exacta (vuelve a cada ubicación lo que
     *   salió de ella; es lo que usan la cancelación de factura y las
     *   compensaciones).
     * - Con `almacenId` + `contenedorId`: a esa ubicación.
     * - Sin ubicación: política por defecto (ver `resolverDestino`).
     */
    async reponerProducto(opts: {
        productoId: string | Types.ObjectId;
        cantidad?: number;
        ubicaciones?: UbicacionCantidad[];
        almacenId?: string | Types.ObjectId;
        contenedorId?: string | Types.ObjectId;
    }): Promise<ResultadoMovimiento> {
        const productoId = this.comoObjectId(
            opts.productoId,
            'El ID del producto no es válido',
        );

        const existe = await this.productoModel.exists({ _id: productoId });

        if (!existe) {
            throw new NotFoundException('El producto no existe');
        }

        let destinos: UbicacionCantidad[];

        if (opts.ubicaciones?.length) {
            destinos = fusionarUbicaciones(
                opts.ubicaciones.map((u) => ({
                    almacen: this.comoObjectId(
                        u.almacen,
                        'El ID del almacén no es válido',
                    ),
                    contenedor: this.comoObjectId(
                        u.contenedor,
                        'El ID del contenedor no es válido',
                    ),
                    cantidad: this.cantidadValida(u.cantidad),
                })),
            );
        } else {
            const cantidad = this.cantidadValida(opts.cantidad);
            const destino = await this.resolverDestino(
                productoId,
                opts.almacenId,
                opts.contenedorId,
            );
            destinos = [{ ...destino, cantidad }];
        }

        const aplicadas: UbicacionCantidad[] = [];

        try {
            for (const destino of destinos) {
                await this.sumarEnUbicacion(
                    productoId,
                    destino.almacen,
                    destino.contenedor,
                    destino.cantidad,
                );
                aplicadas.push(destino);
            }

            const total = redondear(
                destinos.reduce((suma, d) => suma + d.cantidad, 0),
            );
            const stockTotal = await this.moverCacheProducto(productoId, total);

            return { ubicaciones: destinos, stockTotal };
        } catch (error) {
            await this.compensarReposicion(productoId, aplicadas);
            throw error;
        }
    }

    /**
     * Deja una existencia en una cantidad exacta (la crea si no existe) y
     * devuelve la cantidad anterior. Solo para la conciliación: no mueve el
     * total del producto, quien llama lo sincroniza con `fijarStockProducto`.
     */
    async fijarCantidad(
        productoId: Types.ObjectId,
        almacenId: Types.ObjectId,
        contenedorId: Types.ObjectId,
        cantidad: number,
    ): Promise<number> {
        if (!Number.isFinite(cantidad) || cantidad < 0) {
            throw new BadRequestException(
                'La cantidad no puede ser negativa',
            );
        }

        const fijada = redondear(cantidad);
        const filtro = this.filtroUbicacion(productoId, almacenId, contenedorId);

        for (let intento = 0; intento < MAX_INTENTOS_FILA_NUEVA; intento++) {
            // Encuentra la fila aunque sus ids estén guardados como texto.
            const anterior = await this.existenciaModel
                .findOneAndUpdate(
                    filtro,
                    { $set: { cantidad: fijada } },
                    { returnDocument: 'before' },
                )
                .lean()
                .exec();

            if (anterior) {
                return redondear(Number(anterior.cantidad) || 0);
            }

            try {
                await this.existenciaModel.create({
                    producto: productoId,
                    almacen: almacenId,
                    contenedor: contenedorId,
                    cantidad: fijada,
                });

                return 0;
            } catch (error) {
                // Otro movimiento creó la fila a la vez: se fija sobre ella.
                if (!esClaveDuplicada(error)) {
                    throw error;
                }
            }
        }

        throw new ConflictException(
            'No se pudo fijar la existencia por movimientos simultáneos; vuelva a intentarlo',
        );
    }

    /** Fija el total sincronizado del producto (solo conciliación). */
    async fijarStockProducto(
        productoId: Types.ObjectId,
        stock: number,
    ): Promise<void> {
        await this.productoModel
            .updateOne(
                { _id: productoId },
                { $set: { stock_inicial: redondear(stock) } },
            )
            .exec();
    }

    /** Suma de las existencias de un producto en todas sus ubicaciones. */
    async sumarExistencias(productoId: Types.ObjectId): Promise<number> {
        const [resultado] = await this.existenciaModel
            .aggregate<{ total: number }>([
                { $match: { producto: { $in: ambosTipos(productoId) } } },
                { $group: { _id: null, total: { $sum: '$cantidad' } } },
            ])
            .exec();

        return redondear(resultado?.total ?? 0);
    }

    /**
     * Deja los ids de las existencias como ObjectId (ver `aObjectId`).
     *
     * Las filas antiguas que creaba `sincronizarUbicacionInicial` copiando el
     * texto del producto tienen el almacén y el contenedor como texto: la
     * transferencia (que busca con ObjectId) no las encuentra y una reposición
     * abriría otra fila para la misma ubicación. Aquí se convierten y, si una
     * ubicación quedó repetida (una fila con texto y otra con ObjectId), se
     * suman en una sola. La suma por producto no cambia.
     *
     * Es idempotente: sin nada que arreglar no escribe. Con `productoId` solo
     * revisa ese producto; sin él, toda la colección (al activar el modo
     * unificado).
     */
    async normalizarExistencias(
        productoId?: Types.ObjectId,
    ): Promise<ResultadoNormalizacion> {
        const filas = await this.existenciaModel
            .find(productoId ? { producto: { $in: ambosTipos(productoId) } } : {})
            .select('producto almacen contenedor cantidad')
            .lean()
            .exec();

        const grupos = new Map<string, typeof filas>();

        for (const fila of filas) {
            const clave = `${String(fila.producto)}|${String(fila.almacen)}|${String(fila.contenedor)}`;
            const grupo = grupos.get(clave);

            if (grupo) {
                grupo.push(fila);
            } else {
                grupos.set(clave, [fila]);
            }
        }

        const resultado: ResultadoNormalizacion = { convertidas: 0, fusionadas: 0 };

        for (const grupo of grupos.values()) {
            const producto = aObjectId(grupo[0].producto);
            const almacen = aObjectId(grupo[0].almacen);
            const contenedor = aObjectId(grupo[0].contenedor);

            if (!producto || !almacen || !contenedor) {
                this.logger.warn(
                    `Existencia ${String(grupo[0]._id)} con ids no válidos (producto ${String(grupo[0].producto)}, almacén ${String(grupo[0].almacen)}, contenedor ${String(grupo[0].contenedor)}): no se normaliza`,
                );
                continue;
            }

            const conTexto = (f: (typeof filas)[number]): boolean =>
                esIdEnTexto(f.producto) ||
                esIdEnTexto(f.almacen) ||
                esIdEnTexto(f.contenedor);

            if (grupo.length === 1 && !conTexto(grupo[0])) {
                continue;
            }

            // Se conserva la fila que ya tiene los tres ids como ObjectId; si
            // ninguna los tiene, la primera.
            const elegida = grupo.find((f) => !conTexto(f)) ?? grupo[0];
            const sobrantes = grupo.filter((f) => f !== elegida);
            const retiradas: (typeof filas)[number][] = [];
            let retirado = 0;

            try {
                for (const sobrante of sobrantes) {
                    const borrada = await this.existenciaModel
                        .findOneAndDelete({ _id: sobrante._id })
                        .lean()
                        .exec();

                    if (borrada) {
                        retiradas.push(borrada);
                        retirado = redondear(
                            retirado + (Number(borrada.cantidad) || 0),
                        );
                    }
                }

                await this.existenciaModel
                    .updateOne(
                        { _id: elegida._id },
                        {
                            $set: { producto, almacen, contenedor },
                            ...(retirado !== 0
                                ? { $inc: { cantidad: retirado } }
                                : {}),
                        },
                    )
                    .exec();
            } catch (error) {
                // No se pierde cantidad: se devuelve lo que se había retirado.
                await this.restaurarFilas(retiradas);
                throw error;
            }

            resultado.fusionadas += retiradas.length;

            if (conTexto(elegida)) {
                resultado.convertidas += 1;
            }
        }

        if (resultado.convertidas > 0 || resultado.fusionadas > 0) {
            this.logger.log(
                `Existencias normalizadas${productoId ? ` (producto ${String(productoId)})` : ''}: ${resultado.convertidas} con ids de texto convertidas, ${resultado.fusionadas} filas repetidas sumadas`,
            );
        }

        return resultado;
    }

    // ─── Auxiliares de la Fase 1 ─────────────────────────────────────

    private comoObjectId(
        valor: unknown,
        mensaje: string,
    ): Types.ObjectId {
        const id = aObjectId(valor);

        if (!id) {
            throw new BadRequestException(mensaje);
        }

        return id;
    }

    private cantidadValida(valor: unknown): number {
        const numero = Number(valor);

        if (!Number.isFinite(numero) || numero <= EPSILON) {
            throw new BadRequestException(
                'La cantidad debe ser mayor que cero',
            );
        }

        return redondear(numero);
    }

    private sumar(filas: { cantidad: number }[]): number {
        return redondear(filas.reduce((suma, f) => suma + f.cantidad, 0));
    }

    private filtroFilas(
        productoId: Types.ObjectId,
        almacenId?: string | Types.ObjectId,
        contenedorId?: string | Types.ObjectId,
    ): Record<string, unknown> {
        // `$in` con las dos formas del id: las filas antiguas pueden tenerlo
        // guardado como texto (ver `aObjectId`).
        const filtro: Record<string, unknown> = {
            producto: { $in: ambosTipos(productoId) },
        };

        if (almacenId) {
            filtro.almacen = {
                $in: ambosTipos(
                    this.comoObjectId(almacenId, 'El ID del almacén no es válido'),
                ),
            };
        }

        if (contenedorId) {
            filtro.contenedor = {
                $in: ambosTipos(
                    this.comoObjectId(
                        contenedorId,
                        'El ID del contenedor no es válido',
                    ),
                ),
            };
        }

        return filtro;
    }

    /** Filtro de una ubicación exacta, tolerante a ids guardados como texto. */
    private filtroUbicacion(
        productoId: Types.ObjectId,
        almacenId: Types.ObjectId,
        contenedorId: Types.ObjectId,
    ): Record<string, unknown> {
        return {
            producto: { $in: ambosTipos(productoId) },
            almacen: { $in: ambosTipos(almacenId) },
            contenedor: { $in: ambosTipos(contenedorId) },
        };
    }

    /**
     * Suma `cantidad` a la fila de una ubicación y la crea si no existe.
     *
     * Encuentra la fila aunque sus ids estén guardados como texto (datos
     * antiguos), para no abrir una segunda fila de la misma ubicación; la fila
     * nueva se crea siempre con ObjectId. Si otro movimiento la crea a la vez
     * (índice único), se vuelve a sumar sobre la que ganó.
     */
    private async sumarEnUbicacion(
        productoId: Types.ObjectId,
        almacenId: Types.ObjectId,
        contenedorId: Types.ObjectId,
        cantidad: number,
    ): Promise<void> {
        const filtro = this.filtroUbicacion(productoId, almacenId, contenedorId);

        for (let intento = 0; intento < MAX_INTENTOS_FILA_NUEVA; intento++) {
            const resultado = await this.existenciaModel
                .updateOne(filtro, { $inc: { cantidad } })
                .exec();

            if (resultado.matchedCount > 0) {
                return;
            }

            try {
                await this.existenciaModel.create({
                    producto: productoId,
                    almacen: almacenId,
                    contenedor: contenedorId,
                    cantidad,
                });

                return;
            } catch (error) {
                if (!esClaveDuplicada(error)) {
                    throw error;
                }
            }
        }

        throw new ConflictException(
            'No se pudo actualizar la existencia por movimientos simultáneos; vuelva a intentarlo',
        );
    }

    /** Vuelve a insertar filas retiradas por una normalización que falló. */
    private async restaurarFilas(
        filas: {
            _id: Types.ObjectId;
            producto: Types.ObjectId;
            almacen: Types.ObjectId;
            contenedor: Types.ObjectId;
            cantidad: number;
        }[],
    ): Promise<void> {
        for (const fila of filas) {
            try {
                // Con los mismos ids y tipos que tenía la fila retirada.
                await this.existenciaModel.create({
                    _id: fila._id,
                    producto: fila.producto,
                    almacen: fila.almacen,
                    contenedor: fila.contenedor,
                    cantidad: Number(fila.cantidad) || 0,
                });
            } catch (error) {
                this.logger.error(
                    `No se pudo restaurar la existencia ${String(fila._id)} (producto ${String(fila.producto)}, almacén ${String(fila.almacen)}, contenedor ${String(fila.contenedor)}, cantidad ${String(fila.cantidad)}) tras un fallo al normalizar; recrearla a mano: ${String(error)}`,
                );
            }
        }
    }

    private async leerFilasConStock(
        filtro: Record<string, unknown>,
    ): Promise<FilaExistencia[]> {
        const filas = await this.existenciaModel
            .find({ ...filtro, cantidad: { $gt: EPSILON } })
            .select('almacen contenedor cantidad')
            .lean()
            .exec();

        // Las ubicaciones que se devuelven (y que quedan en la venta o la
        // factura) son siempre ObjectId, aunque la fila antigua las tenga en texto.
        return filas.map((fila) => ({
            _id: fila._id,
            almacen: aObjectId(fila.almacen) ?? fila.almacen,
            contenedor: aObjectId(fila.contenedor) ?? fila.contenedor,
            cantidad: Number(fila.cantidad) || 0,
        }));
    }

    /**
     * Descuento atómico de una fila. `false` si otro movimiento ya la dejó
     * sin stock suficiente. Un error de escritura es ambiguo (puede haberse
     * aplicado): se registra y se propaga sin compensar esa fila.
     */
    private async decrementarFila(
        asignacion: AsignacionDescuento,
    ): Promise<boolean> {
        try {
            const resultado = await this.existenciaModel
                .updateOne(
                    {
                        _id: asignacion.existenciaId,
                        cantidad: {
                            $gte: Math.max(
                                0,
                                asignacion.cantidad - TOLERANCIA_SALDO,
                            ),
                        },
                    },
                    { $inc: { cantidad: -asignacion.cantidad } },
                )
                .exec();

            return resultado.modifiedCount === 1;
        } catch (error) {
            this.logger.error(
                `Descuento de existencia ambiguo (existencia ${String(asignacion.existenciaId)}, cantidad ${asignacion.cantidad}): pudo aplicarse o no, conciliar a mano; no se compensa: ${String(error)}`,
            );
            throw error;
        }
    }

    /** Suma/resta el delta al total sincronizado del producto con `$inc`. */
    private async moverCacheProducto(
        productoId: Types.ObjectId,
        delta: number,
    ): Promise<number> {
        const producto = await this.productoModel
            .findOneAndUpdate(
                { _id: productoId },
                { $inc: { stock_inicial: delta } },
                { returnDocument: 'after' },
            )
            .lean()
            .exec();

        if (!producto) {
            throw new NotFoundException('El producto no existe');
        }

        // Kardex.stock no admite negativos: un total sincronizado desfasado
        // se ve en la conciliación, no como un número negativo en el kardex.
        return Math.max(0, redondear(Number(producto.stock_inicial) || 0));
    }

    private async compensarDescuento(
        aplicadas: AsignacionDescuento[],
    ): Promise<void> {
        for (const asignacion of aplicadas) {
            try {
                await this.existenciaModel
                    .updateOne(
                        { _id: asignacion.existenciaId },
                        { $inc: { cantidad: asignacion.cantidad } },
                    )
                    .exec();
            } catch (error) {
                this.logger.error(
                    `Compensación de descuento fallida, corregir a mano (existencia ${String(asignacion.existenciaId)}, cantidad ${asignacion.cantidad}): ${String(error)}`,
                );
            }
        }
    }

    private async compensarReposicion(
        productoId: Types.ObjectId,
        aplicadas: UbicacionCantidad[],
    ): Promise<void> {
        for (const ubicacion of aplicadas) {
            try {
                await this.existenciaModel
                    .updateOne(
                        {
                            ...this.filtroUbicacion(
                                productoId,
                                ubicacion.almacen,
                                ubicacion.contenedor,
                            ),
                            cantidad: {
                                $gte: Math.max(
                                    0,
                                    ubicacion.cantidad - TOLERANCIA_SALDO,
                                ),
                            },
                        },
                        { $inc: { cantidad: -ubicacion.cantidad } },
                    )
                    .exec();
            } catch (error) {
                this.logger.error(
                    `Compensación de reposición fallida, corregir a mano (producto ${String(productoId)}, almacén ${String(ubicacion.almacen)}, contenedor ${String(ubicacion.contenedor)}, cantidad ${ubicacion.cantidad}): ${String(error)}`,
                );
            }
        }
    }

    /**
     * Ubicación donde reponer stock cuando quien repone no la indica:
     * 1) la ubicación por defecto del producto, si es válida (y está en el
     *    almacén pedido, si se pidió uno);
     * 2) la ubicación del producto con más stock;
     * 3) con almacén indicado, su primer contenedor.
     * Si no hay ninguna, error claro: es mejor pedir la ubicación que
     * inventarla.
     */
    private async resolverDestino(
        productoId: Types.ObjectId,
        almacenId?: string | Types.ObjectId,
        contenedorId?: string | Types.ObjectId,
    ): Promise<{ almacen: Types.ObjectId; contenedor: Types.ObjectId }> {
        if (contenedorId) {
            const contenedor = this.comoObjectId(
                contenedorId,
                'El ID del contenedor no es válido',
            );
            const fila = await this.contenedorModel
                .findById(contenedor)
                .select('almacen')
                .lean()
                .exec();

            if (!fila) {
                throw new NotFoundException('El contenedor no existe');
            }

            if (
                almacenId &&
                String(fila.almacen) !== String(almacenId)
            ) {
                throw new BadRequestException(
                    'El contenedor no pertenece al almacén indicado',
                );
            }

            // `contenedores.almacen` suele estar guardado como texto.
            const almacenDelContenedor = aObjectId(fila.almacen);

            if (!almacenDelContenedor) {
                throw new BadRequestException(
                    'El contenedor no tiene un almacén válido',
                );
            }

            return { almacen: almacenDelContenedor, contenedor };
        }

        const almacen = almacenId
            ? this.comoObjectId(almacenId, 'El ID del almacén no es válido')
            : undefined;

        const producto = await this.productoModel
            .findById(productoId)
            .select('almacen contenedor')
            .lean()
            .exec();

        // La ubicación del producto se guarda con el texto del formulario.
        const almacenProducto = aObjectId(producto?.almacen);
        const contenedorProducto = aObjectId(producto?.contenedor);

        if (
            almacenProducto &&
            contenedorProducto &&
            (!almacen || String(almacenProducto) === String(almacen))
        ) {
            const valido = await this.contenedorModel.exists({
                _id: contenedorProducto,
                almacen: { $in: ambosTipos(almacenProducto) },
            });

            if (valido) {
                return {
                    almacen: almacenProducto,
                    contenedor: contenedorProducto,
                };
            }
        }

        const filas = await this.existenciaModel
            .find({
                producto: { $in: ambosTipos(productoId) },
                ...(almacen ? { almacen: { $in: ambosTipos(almacen) } } : {}),
            })
            .select('almacen contenedor cantidad')
            .lean()
            .exec();

        const conUbicacion = filas.flatMap((fila) => {
            const a = aObjectId(fila.almacen);
            const c = aObjectId(fila.contenedor);

            return a && c
                ? [{ almacen: a, contenedor: c, cantidad: Number(fila.cantidad) || 0 }]
                : [];
        });

        if (conUbicacion.length > 0) {
            const mejor = [...conUbicacion].sort(
                (a, b) => b.cantidad - a.cantidad,
            )[0];

            return { almacen: mejor.almacen, contenedor: mejor.contenedor };
        }

        if (almacen) {
            const primero = await this.contenedorModel
                .findOne({ almacen: { $in: ambosTipos(almacen) } })
                .sort({ _id: 1 })
                .select('_id')
                .lean()
                .exec();

            if (primero) {
                this.logger.warn(
                    `Producto ${String(productoId)} sin ubicación: se repone en el primer contenedor del almacén ${String(almacen)}`,
                );

                return {
                    almacen,
                    contenedor: primero._id,
                };
            }
        }

        throw new BadRequestException(
            'El producto no tiene una ubicación (almacén y contenedor) donde registrar el stock; indíquela',
        );
    }
}
