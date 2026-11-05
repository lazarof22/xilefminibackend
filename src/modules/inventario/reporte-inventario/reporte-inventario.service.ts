import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Producto } from '../producto/schemas/producto.schema';
import { ExistenciaService } from '../exitencia/existencia.service';
import { ReporteInventarioItemDto } from './dto/reporte-inventario-item.dto';
import { ReservasPorProductoService } from './reservas-por-producto.service';

/** Cantidad numérica segura: un valor ausente o no numérico cuenta como 0. */
function cantidad(valor: unknown): number {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

@Injectable()
export class ReporteInventarioService {
  constructor(
    @InjectModel(Producto.name) private readonly productoModel: Model<Producto>,
    private readonly reservas: ReservasPorProductoService,
    private readonly existenciaService: ExistenciaService,
  ) {}

  /**
   * Una fila por producto. Con las existencias unificadas (doc §6.1) se agrega
   * sobre `Existencia`:
   *   disponibles = Σ disponible (cantidad − reservada)
   *   reservados  = Σ reservada
   *   total       = Σ cantidad (la existencia FÍSICA, no el disponible)
   * Antes de unificar se conserva el cálculo de siempre:
   *   disponibles = stock del producto (`stock_inicial`)
   *   reservados  = lo que informe el módulo de reservas (hoy 0)
   *   total       = disponibles − reservados
   */
  async obtenerReporte(): Promise<ReporteInventarioItemDto[]> {
    if (await this.existenciaService.estaUnificado()) {
      return this.reporteUnificado();
    }

    const [productos, reservadosPorProducto] = await Promise.all([
      this.productoModel
        .find()
        .select('codigo_producto nombre_producto stock_inicial')
        .sort({ codigo_producto: 1 })
        .lean()
        .exec(),
      this.reservas.obtenerPorProducto(),
    ]);

    return productos.map((producto) => {
      const id = String(producto._id);
      const disponibles = cantidad(producto.stock_inicial);
      const reservados = cantidad(reservadosPorProducto.get(id));

      return {
        _id: id,
        codigo_producto: producto.codigo_producto,
        nombre_producto: producto.nombre_producto,
        productos_disponibles: disponibles,
        productos_reservados: reservados,
        inventario_total: disponibles - reservados,
      };
    });
  }

  private async reporteUnificado(): Promise<ReporteInventarioItemDto[]> {
    const [productos, totales] = await Promise.all([
      this.productoModel
        .find()
        .select('codigo_producto nombre_producto')
        .sort({ codigo_producto: 1 })
        .lean()
        .exec(),
      this.existenciaService.totalesPorProducto(),
    ]);

    return productos.map((producto) => {
      const id = String(producto._id);
      const total = totales.get(id);

      return {
        _id: id,
        codigo_producto: producto.codigo_producto,
        nombre_producto: producto.nombre_producto,
        productos_disponibles: total?.disponible ?? 0,
        productos_reservados: total?.reservada ?? 0,
        inventario_total: total?.cantidad ?? 0,
      };
    });
  }
}
