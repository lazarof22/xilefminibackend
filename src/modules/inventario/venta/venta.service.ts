import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateVentaDto } from './dto/create-venta.dto';
import { UpdateVentaDto } from './dto/update-venta.dto';
import { Venta } from './schema/venta.schema';
import { Cliente } from '../../clientes y provedores/cliente/schemas/cliente.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Kardex } from '../kardex/schema/kardex.schema';
import { Pago } from '../pago/schema/pago.schema';
import { ExistenciaService } from '../exitencia/existencia.service';
import { UbicacionCantidad } from '../exitencia/existencia.types';
import { ReportePlusService } from '../reporte_plus/reporte_plus.service';
import { LineaReportePlus } from '../reporte_plus/dto/registrar-venta-reporte.dto';
import {
  MetodoPagoReporte,
  OrigenReporte,
} from '../reporte_plus/schema/reporte_plus.schema';

/** Lo que se descontó de un producto, para poder deshacerlo si la venta falla. */
interface DescuentoAplicado {
  productoId: Types.ObjectId;
  cantidad: number;
  /** Solo en modo unificado: de qué ubicaciones salió. */
  ubicaciones?: UbicacionCantidad[];
}

/** Línea ya descontada del stock, pendiente de método de pago e impuesto. */
type LineaVenta = Omit<
  LineaReportePlus,
  'metodoPago' | 'referencia' | 'impuesto' | 'total'
> & { neto: number };

@Injectable()
export class VentaService {
  private readonly logger = new Logger(VentaService.name);

  constructor(
    @InjectModel(Venta.name) private ventaModel: Model<Venta>,
    @InjectModel(Cliente.name) private clienteModel: Model<Cliente>,
    @InjectModel(Producto.name) private productoModel: Model<Producto>,
    @InjectModel(Kardex.name) private kardexModel: Model<Kardex>,
    @InjectModel('Pago') private pagoModel: Model<Pago>,
    private readonly reportePlusService: ReportePlusService,
    private readonly existenciaService: ExistenciaService,
  ) {}

  async create(createVentaDto: CreateVentaDto): Promise<Venta> {
    // Verificar cliente
    const cliente = await this.clienteModel.findById(createVentaDto.clienteId);
    if (!cliente) {
      throw new NotFoundException(`Cliente no encontrado`);
    }

    // Modo unificado (Fase 1): el saldo sale de `Existencia`, por ubicación.
    // Antes de activarlo (conciliación) se descuenta `Producto.stock_inicial`.
    const unificado = await this.existenciaService.estaUnificado();

    // Verificar stock y descontar. Si algo falla (un producto sin stock, un
    // error al guardar la venta) se devuelve lo ya descontado: antes quedaba
    // el stock de los productos anteriores descontado sin venta.
    const lineas: LineaVenta[] = [];
    const descontados: DescuentoAplicado[] = [];
    const ubicacionesPorItem: (UbicacionCantidad[] | undefined)[] = [];
    let ventaGuardada: Venta & { _id: unknown };

    try {
      for (const item of createVentaDto.productos) {
        const producto = await this.productoModel.findById(item.productoId);

        if (!producto) {
          throw new NotFoundException(`Producto no encontrado`);
        }

        let stockFinal: number;
        let ubicaciones: UbicacionCantidad[] | undefined;

        if (unificado) {
          const movimiento = await this.existenciaService.descontarProducto({
            productoId: producto._id,
            cantidad: item.cantidad,
          });
          stockFinal = movimiento.stockTotal;
          ubicaciones = movimiento.ubicaciones;
          descontados.push({
            productoId: producto._id,
            cantidad: item.cantidad,
            ubicaciones,
          });
        } else {
          if (producto.stock_inicial < item.cantidad) {
            throw new BadRequestException(
              `Stock insuficiente para ${producto.nombre_producto}`,
            );
          }

          // Descontar stock
          producto.stock_inicial -= item.cantidad;
          await producto.save();
          stockFinal = producto.stock_inicial;
          descontados.push({
            productoId: producto._id,
            cantidad: item.cantidad,
          });
        }

        ubicacionesPorItem.push(ubicaciones);

        const descuentoItem = item.descuentoMonto || 0;
        const bruto = (producto.precio_venta || 0) * item.cantidad;
        lineas.push({
          productoId: producto._id.toString(),
          codigo: producto.codigo_producto,
          nombre: producto.nombre_producto,
          cantidadVendida: item.cantidad,
          stockFinal,
          descuento: descuentoItem,
          origen: OrigenReporte.VENTA,
          enKardex: false,
          neto: Math.max(0, bruto - descuentoItem),
        });

        // Alerta si quedó bajo del mínimo
        if (stockFinal < producto.stock_minimo) {
          console.warn(
            `STOCK BAJO: ${producto.nombre_producto} tiene ${stockFinal} (mín: ${producto.stock_minimo})`,
          );
        }
      }

      // Crear venta (en modo unificado cada línea guarda de qué ubicaciones
      // salió, para poder devolverla exacta en una futura devolución).
      const venta = new this.ventaModel({
        ...createVentaDto,
        productos: createVentaDto.productos.map((p, i) => ({
          ...p,
          ...(ubicacionesPorItem[i]?.length
            ? { ubicaciones: ubicacionesPorItem[i] }
            : {}),
        })),
        clienteNombre: cliente.nombre_cliente,
      });
      ventaGuardada = await venta.save();
    } catch (error) {
      await this.deshacerDescuentos(descontados);
      throw error;
    }

    await this.registrarEnReportePlus(ventaGuardada, createVentaDto, lineas);

    return ventaGuardada;
  }

  /**
   * Devuelve el stock descontado cuando la venta no llega a guardarse. Un
   * fallo al devolver se registra (con todo lo necesario para corregirlo a
   * mano) y no oculta el error original de la venta.
   */
  private async deshacerDescuentos(
    descontados: DescuentoAplicado[],
  ): Promise<void> {
    for (const d of descontados) {
      try {
        if (d.ubicaciones?.length) {
          await this.existenciaService.reponerProducto({
            productoId: d.productoId,
            ubicaciones: d.ubicaciones,
          });
        } else {
          await this.productoModel
            .updateOne(
              { _id: d.productoId },
              { $inc: { stock_inicial: d.cantidad } },
            )
            .exec();
        }
      } catch (error) {
        this.logger.error(
          `No se pudo devolver el stock tras fallar la venta, corregir a mano (producto ${String(d.productoId)}, cantidad ${d.cantidad}): ${String(error)}`,
        );
      }
    }
  }

  /**
   * Una fila por producto en el Reporte Plus, con el método de pago del pago
   * asociado. Si falla, la venta ya existe: se registra el error y no se
   * revierte (el stock ya cambió).
   */
  private async registrarEnReportePlus(
    venta: Venta & { _id: unknown },
    dto: CreateVentaDto,
    lineas: LineaVenta[],
  ): Promise<void> {
    try {
      const pago = (await this.pagoModel.findById(dto.pago).lean().exec()) as {
        metodoPago?: string;
        esCuentaCasa?: boolean;
      } | null;
      const metodo = Object.values(MetodoPagoReporte).includes(
        pago?.metodoPago as MetodoPagoReporte,
      )
        ? (pago!.metodoPago as MetodoPagoReporte)
        : MetodoPagoReporte.EFECTIVO;
      // Cuenta casa: se entrega mercancía sin cobrar, el total pagado es 0.
      const cobrado = pago?.esCuentaCasa ? 0 : 1;
      const netoTotal = lineas.reduce((s, l) => s + l.neto, 0);

      await this.reportePlusService.registrarLineas(
        lineas.map(({ neto, ...l }) => {
          // El impuesto de la venta se reparte proporcional al neto de cada línea.
          const impuesto =
            netoTotal > 0 ? (dto.impuesto * neto) / netoTotal : 0;
          return {
            ...l,
            metodoPago: metodo,
            referencia: String(venta._id),
            impuesto,
            total: (neto + impuesto) * cobrado,
          };
        }),
      );
    } catch (error) {
      this.logger.error(
        `Venta ${String(venta._id)} guardada pero no se pudo registrar en Reporte Plus: ${String(error)}`,
      );
    }
  }

  async findAll(): Promise<Venta[]> {
    return this.ventaModel
      .find()
      .populate('productos.productoId', 'nombre_producto precio')
      .populate('pago')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<Venta> {
    const venta = await this.ventaModel
      .findById(id)
      .populate('productos.productoId', 'nombre_producto precio codigo')
      .populate('pago')
      .exec();

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    return venta;
  }

  async update(id: string, updateVentaDto: UpdateVentaDto) {}

  async remove(id: string): Promise<void> {
    const result = await this.ventaModel.findByIdAndDelete(id).exec();

    if (!result) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }
  }
}
