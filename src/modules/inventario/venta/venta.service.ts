import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateVentaDto } from './dto/create-venta.dto';
import { UpdateVentaDto } from './dto/update-venta.dto';
import { Venta } from './schema/venta.schema';
import { Cliente } from '../../clientes y provedores/cliente/schemas/cliente.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Kardex } from '../kardex/schema/kardex.schema';
import { Pago } from '../pago/schema/pago.schema';
import { ReportePlusService } from '../reporte_plus/reporte_plus.service';
import { LineaReportePlus } from '../reporte_plus/dto/registrar-venta-reporte.dto';
import {
  MetodoPagoReporte,
  OrigenReporte,
} from '../reporte_plus/schema/reporte_plus.schema';

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
  ) {}

  async create(createVentaDto: CreateVentaDto): Promise<Venta> {
    // Verificar cliente
    const cliente = await this.clienteModel.findById(createVentaDto.clienteId);
    if (!cliente) {
      throw new NotFoundException(`Cliente no encontrado`);
    }

    // Verificar stock y descontar
    const lineas: LineaVenta[] = [];
    for (const item of createVentaDto.productos) {
      const producto = await this.productoModel.findById(item.productoId);

      if (!producto) {
        throw new NotFoundException(`Producto no encontrado`);
      }

      if (producto.stock_inicial < item.cantidad) {
        throw new BadRequestException(
          `Stock insuficiente para ${producto.nombre_producto}`,
        );
      }

      // Descontar stock
      producto.stock_inicial -= item.cantidad;
      await producto.save();

      const descuentoItem = item.descuentoMonto || 0;
      const bruto = (producto.precio_venta || 0) * item.cantidad;
      lineas.push({
        productoId: producto._id.toString(),
        codigo: producto.codigo_producto,
        nombre: producto.nombre_producto,
        cantidadVendida: item.cantidad,
        stockFinal: producto.stock_inicial,
        descuento: descuentoItem,
        origen: OrigenReporte.VENTA,
        enKardex: false,
        neto: Math.max(0, bruto - descuentoItem),
      });

      // Alerta si quedó bajo del mínimo
      if (producto.stock_inicial < producto.stock_minimo) {
        console.warn(
          `STOCK BAJO: ${producto.nombre_producto} tiene ${producto.stock_inicial} (mín: ${producto.stock_minimo})`,
        );
      }
    }

    // Crear venta
    const venta = new this.ventaModel({
      ...createVentaDto,
      clienteNombre: cliente.nombre_cliente,
    });
    const ventaGuardada = await venta.save();

    await this.registrarEnReportePlus(ventaGuardada, createVentaDto, lineas);

    return ventaGuardada;
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
