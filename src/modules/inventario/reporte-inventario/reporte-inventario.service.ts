import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Producto } from '../producto/schemas/producto.schema';
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
  ) {}

  /**
   * Una fila por producto:
   *   disponibles = stock del producto (`stock_inicial`)
   *   reservados  = lo que informe el módulo de facturación (hoy 0)
   *   total       = disponibles − reservados
   */
  async obtenerReporte(): Promise<ReporteInventarioItemDto[]> {
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
}
