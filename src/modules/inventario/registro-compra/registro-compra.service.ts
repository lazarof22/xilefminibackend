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
    async create(dto: CreateRegistroCompraDto): Promise<RegistroCompra> {
        const [producto, almacen, contenedor] = await Promise.all([
            this.productoModel
                .findById(dto.producto)
                .select('stock_inicial')
                .lean()
                .exec(),
            this.almacenModel
                .findById(dto.almacen)
                .select('_id')
                .lean()
                .exec(),
            this.contenedorModel
                .findById(dto.contenedor)
                .select('almacen')
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

        const registro = await this.registroCompraModel.create({
            producto: producto._id,
            almacen: almacen._id,
            contenedor: contenedor._id,
            cantidad: dto.cantidad,
            costo_unitario: dto.costo_unitario,
            total,
            fecha,
        });

        try {
            await this.kardexModel.create({
                fecha,
                productoId: producto._id,
                tipo: KardexTipo.COMPRA,
                cantidad: dto.cantidad,
                stock: Math.max(0, Number(producto.stock_inicial) || 0),
                motivo: 'Compra',
                referencia: registro._id.toString(),
            });
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

        return registro;
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
