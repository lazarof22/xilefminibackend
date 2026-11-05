import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { CreateRegistroCompraDto } from './dto/create-registro-compra.dto';
import { RegistroCompra } from './schema/registro-compra.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';
import { costoParaEntrada } from '../kardex/costo-promedio.util';
import { ultimoCostoPromedio } from '../kardex/costo-promedio.consulta';
import { formatearUbicacionFisica } from '../kardex/ubicacion-fisica.util';

/**
 * Datos con los que un documento (p. ej. la Recepción SC-2-04) deja su
 * rastro en el kardex de la compra. Todo es opcional: sin contexto el
 * kardex queda exactamente como lo escribía `create`.
 */
export interface ContextoMovimientoCompra {
    /** Documento que origina el movimiento (por defecto, el id de la compra). */
    referencia?: string;
    motivo?: string;
    importeCUP?: number;
    costoPromedio?: number;
    ubicacionFisica?: string;
    /**
     * Saldo total del producto ANTES de esta entrada. Quien ya movió el
     * stock (la Recepción) lo informa desde la suma de `Existencia`; si no,
     * se deduce de `Producto.stock_inicial`, que ya incluye la entrada.
     */
    stockAnterior?: number;
}

/** Lo que dejó escrito una compra: el registro y su movimiento de kardex. */
export interface LineaCompraRegistrada {
    registro: RegistroCompra;
    kardexId?: string;
}

@Injectable()
export class RegistroCompraService {
    private readonly logger = new Logger(RegistroCompraService.name);

    constructor(
        @InjectModel(RegistroCompra.name)
        private readonly registroCompraModel: Model<RegistroCompra>,

        @InjectModel(Producto.name)
        private readonly productoModel: Model<Producto>,

        @InjectModel(Almacen.name)
        private readonly almacenModel: Model<Almacen>,

        @InjectModel(Contenedor.name)
        private readonly contenedorModel: Model<Contenedor>,

        @InjectModel(Kardex.name)
        private readonly kardexModel: Model<Kardex>,
    ) {}

    /**
     * Registra una compra y su movimiento de kardex (tipo COMPRA).
     *
     * IMPORTANTE: no modifica el stock. El flujo del formulario primero
     * crea el producto con `stock_inicial = cantidad` (POST /producto, que
     * también crea su existencia) y después registra la compra aquí; sumar
     * de nuevo duplicaría el stock. El kardex guarda el stock actual del
     * producto en ese momento.
     *
     * Son dos escrituras sin transacción (funciona en MongoDB
     * independiente): si el kardex falla, se elimina la compra para no
     * dejar un registro sin su movimiento.
     */
    async create(
        dto: CreateRegistroCompraDto,
        contexto?: ContextoMovimientoCompra,
    ): Promise<RegistroCompra> {
        return (await this.registrarLinea(dto, contexto)).registro;
    }

    /**
     * Igual que `create`, pero devuelve también el id del kardex escrito para
     * que quien registra varias líneas (la Recepción) pueda deshacer una a
     * una si alguna posterior falla.
     */
    async registrarLinea(
        dto: CreateRegistroCompraDto,
        contexto: ContextoMovimientoCompra = {},
    ): Promise<LineaCompraRegistrada> {
        const [producto, almacen, contenedor] = await Promise.all([
            this.productoModel
                .findById(dto.producto)
                .select('stock_inicial precio_compra')
                .lean()
                .exec(),
            this.almacenModel
                .findById(dto.almacen)
                .select('nombreAlmacen')
                .lean()
                .exec(),
            this.contenedorModel
                .findById(dto.contenedor)
                .select('almacen nombreContenedor seccion estante casilla')
                .lean()
                .exec(),
        ]);

        if (!producto) {
            throw new NotFoundException('El producto no existe');
        }

        if (!almacen) {
            throw new NotFoundException('El almacén no existe');
        }

        if (!contenedor) {
            throw new NotFoundException('El contenedor no existe');
        }

        if (contenedor.almacen.toString() !== almacen._id.toString()) {
            throw new BadRequestException(
                'El contenedor no pertenece al almacén seleccionado',
            );
        }

        const total = this.redondear(dto.cantidad * dto.costo_unitario);
        const fecha = this.parseFecha(dto.fecha);
        const stockActual = Math.max(0, Number(producto.stock_inicial) || 0);
        const costoPromedio =
            contexto.costoPromedio ??
            costoParaEntrada({
                ultimoPromedio: await ultimoCostoPromedio(
                    this.kardexModel,
                    producto._id,
                ),
                precioCompra: producto.precio_compra,
                stockAnterior:
                    contexto.stockAnterior ??
                    Math.max(0, this.redondear(stockActual - dto.cantidad)),
                cantidad: dto.cantidad,
                costoUnitario: dto.costo_unitario,
            });
        const ubicacionFisica =
            contexto.ubicacionFisica ??
            formatearUbicacionFisica({
                almacen: almacen.nombreAlmacen,
                contenedor: contenedor.nombreContenedor,
                seccion: contenedor.seccion,
                estante: contenedor.estante,
                casilla: contenedor.casilla,
            });

        const registro = await this.registroCompraModel.create({
            producto: producto._id,
            almacen: almacen._id,
            contenedor: contenedor._id,
            cantidad: dto.cantidad,
            costo_unitario: dto.costo_unitario,
            total,
            fecha,
        });

        let kardexId: string | undefined;

        try {
            const kardex = await this.kardexModel.create({
                fecha,
                productoId: producto._id,
                tipo: KardexTipo.COMPRA,
                cantidad: dto.cantidad,
                stock: stockActual,
                motivo: contexto.motivo ?? 'Compra',
                referencia: contexto.referencia ?? registro._id.toString(),
                // Submayor SC-2-13. `referenciaContable` e `importeDivisa`
                // quedan sin definir: aún no hay asiento ni compra en divisa.
                importeCUP: total,
                costoPromedio,
                ...(ubicacionFisica ? { ubicacionFisica } : {}),
                ...this.camposContables(contexto),
            });
            kardexId = kardex._id?.toString();
        } catch (error) {
            try {
                await this.registroCompraModel.deleteOne({ _id: registro._id });
            } catch (rollbackError) {
                this.logger.error(
                    `No se pudo eliminar la compra ${registro._id.toString()} tras fallar su kardex: ${String(rollbackError)}`,
                );
            }

            throw error;
        }

        return { registro, kardexId };
    }

    /**
     * Deshace una línea registrada cuyo documento no llegó a completarse:
     * elimina la compra y su kardex. Solo para compensar un registro en
     * curso; un movimiento ya completo se corrige con otro movimiento.
     */
    async descartarLinea(linea: {
        registroId: string;
        kardexId?: string;
    }): Promise<void> {
        if (linea.kardexId) {
            await this.kardexModel.deleteOne({ _id: linea.kardexId });
        }
        await this.registroCompraModel.deleteOne({ _id: linea.registroId });
    }

    /** Campos contables del contexto que vienen definidos (los ausentes no se escriben). */
    private camposContables(
        contexto: ContextoMovimientoCompra,
    ): Partial<
        Pick<
            ContextoMovimientoCompra,
            'importeCUP' | 'costoPromedio' | 'ubicacionFisica'
        >
    > {
        const campos = ['importeCUP', 'costoPromedio', 'ubicacionFisica'] as const;
        return Object.fromEntries(
            campos
                .filter((campo) => contexto[campo] !== undefined)
                .map((campo) => [campo, contexto[campo]]),
        );
    }

    async findAll(): Promise<RegistroCompra[]> {
        return this.registroCompraModel
            .find()
            .populate({ path: 'producto', select: 'nombre_producto codigo_producto' })
            .populate({ path: 'almacen', select: 'nombreAlmacen' })
            .populate({ path: 'contenedor', select: 'nombreContenedor' })
            .sort({ fecha: -1, createdAt: -1 })
            .lean()
            .exec();
    }

    async findOne(id: string): Promise<RegistroCompra> {
        if (!Types.ObjectId.isValid(id)) {
            throw new BadRequestException('El ID de la compra no es válido');
        }

        const registro = await this.registroCompraModel
            .findById(id)
            .populate({ path: 'producto', select: 'nombre_producto codigo_producto' })
            .populate({ path: 'almacen', select: 'nombreAlmacen' })
            .populate({ path: 'contenedor', select: 'nombreContenedor' })
            .lean()
            .exec();

        if (!registro) {
            throw new NotFoundException('No se encontró la compra');
        }

        return registro;
    }

    private redondear(valor: number): number {
        return Math.round((valor + Number.EPSILON) * 100) / 100;
    }

    /**
     * "2026-10-05" (solo fecha) se guarda a mediodía UTC para que no se
     * corra de día al mostrarla en zonas horarias al oeste de UTC (en
     * medianoche UTC aparecería como el día anterior).
     */
    private parseFecha(fecha?: string): Date {
        if (!fecha) {
            return new Date();
        }

        return /^\d{4}-\d{2}-\d{2}$/.test(fecha)
            ? new Date(`${fecha}T12:00:00.000Z`)
            : new Date(fecha);
    }
}
