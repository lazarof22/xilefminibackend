import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ipv } from './schema/ipv.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Venta } from '../venta/schema/venta.schema';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';
import { GuardarIpvDto } from './dto/guardar-ipv.dto';
import { UpdateIpvDto } from './dto/update-ipv.dto';
import { normalizarFecha, rangoDelDia } from '../../../common/utils/fecha.util';

const TIPOS_ENTRADA = [
  KardexTipo.ENTRADA,
  KardexTipo.COMPRA,
  KardexTipo.TRANSFERENCIA_ENTRADA,
  KardexTipo.DEVOLUCION,
];
const TIPOS_DISMINUCION = [KardexTipo.SALIDA, KardexTipo.TRANSFERENCIA_SALIDA];

interface MovimientosIpv {
  inventarioInicial: number;
  entradas: number;
  ajusteDisminucion: number;
  venta: number;
  precioCosto: number;
  precioVenta: number;
}

export interface IpvFila extends MovimientosIpv {
  _id: string | null;
  fecha: string;
  productoId: string;
  codigoProducto: string;
  nombreProducto: string;
  disponible: number;
  inventarioFinal: number;
  importeVenta: number;
  importeCosto: number;
  guardado: boolean;
}

export interface IpvDia {
  fecha: string;
  guardado: boolean;
  items: IpvFila[];
}

@Injectable()
export class IpvService {
  constructor(
    @InjectModel(Ipv.name) private ipvModel: Model<Ipv>,
    @InjectModel(Producto.name) private productoModel: Model<Producto>,
    @InjectModel(Venta.name) private ventaModel: Model<Venta>,
    @InjectModel(Kardex.name) private kardexModel: Model<Kardex>,
  ) {}

  /**
   * IPV del día para todos los productos. Los productos con fila guardada
   * devuelven lo guardado; el resto se precarga con:
   * - inventario inicial: inventario final del último IPV guardado o, si no
   *   hay, el stock actual reconstruido al inicio del día;
   * - entradas / ajustes: movimientos de Kardex del día;
   * - venta: unidades vendidas en el día (colección Venta).
   */
  async obtenerDia(fecha?: string): Promise<IpvDia> {
    const fechaDia = normalizarFecha(fecha);
    const [productos, guardados] = await Promise.all([
      this.productoModel.find().sort({ nombre_producto: 1 }).lean().exec(),
      this.ipvModel.find({ fecha: fechaDia }).lean().exec(),
    ]);

    const guardadoPorProducto = new Map(
      guardados.map((g) => [String(g.producto), g]),
    );
    const sinGuardar = productos.filter(
      (p) => !guardadoPorProducto.has(String(p._id)),
    );
    const sugeridos = sinGuardar.length
      ? await this.calcularSugeridos(
          fechaDia,
          sinGuardar.map((p) => p._id),
        )
      : new Map<string, Partial<MovimientosIpv>>();

    const items: IpvFila[] = productos.map((producto) => {
      const id = String(producto._id);
      const guardado = guardadoPorProducto.get(id);
      const base = {
        fecha: fechaDia,
        productoId: id,
        codigoProducto: producto.codigo_producto ?? '',
        nombreProducto: producto.nombre_producto,
      };

      if (guardado) {
        return {
          ...base,
          ...this.calcularFila(guardado),
          _id: String(guardado._id),
          guardado: true,
        };
      }

      const sugerido = sugeridos.get(id) ?? {};
      const entradas = sugerido.entradas ?? 0;
      const ajusteDisminucion = sugerido.ajusteDisminucion ?? 0;
      const venta = sugerido.venta ?? 0;
      const inventarioInicial =
        sugerido.inventarioInicial ??
        Math.max(
          0,
          (producto.stock_inicial || 0) - entradas + ajusteDisminucion + venta,
        );

      return {
        ...base,
        ...this.calcularFila({
          precioCosto: producto.precio_compra || 0,
          precioVenta: producto.precio_venta || 0,
          inventarioInicial,
          entradas,
          ajusteDisminucion,
          venta,
        }),
        _id: null,
        guardado: false,
      };
    });

    return { fecha: fechaDia, guardado: guardados.length > 0, items };
  }

  /** Días que tienen IPV guardado, del más reciente al más antiguo. */
  async listarFechas(): Promise<string[]> {
    const fechas = await this.ipvModel.distinct('fecha').exec();
    return fechas.sort((a, b) => b.localeCompare(a));
  }

  /** Crea o actualiza (por producto y día) las filas enviadas. */
  async guardar(dto: GuardarIpvDto): Promise<IpvDia> {
    const fechaDia = normalizarFecha(dto.fecha);
    const ids = dto.items.map((i) => new Types.ObjectId(i.producto));
    const productos = await this.productoModel
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
    const productoPorId = new Map(productos.map((p) => [String(p._id), p]));

    const faltantes = dto.items.filter((i) => !productoPorId.has(i.producto));
    if (faltantes.length) {
      throw new NotFoundException(
        `Productos no encontrados: ${faltantes.map((f) => f.producto).join(', ')}`,
      );
    }

    if (dto.items.length) {
      await this.ipvModel.bulkWrite(
        dto.items.map((item) => {
          const producto = productoPorId.get(item.producto)!;
          const fila = this.calcularFila({
            precioCosto: item.precioCosto ?? producto.precio_compra ?? 0,
            precioVenta: item.precioVenta ?? producto.precio_venta ?? 0,
            inventarioInicial: item.inventarioInicial,
            entradas: item.entradas,
            ajusteDisminucion: item.ajusteDisminucion,
            venta: item.venta,
          });
          return {
            updateOne: {
              filter: { fecha: fechaDia, producto: producto._id },
              update: {
                $set: { ...fila, nombreProducto: producto.nombre_producto },
              },
              upsert: true,
            },
          };
        }),
      );
    }

    return this.obtenerDia(fechaDia);
  }

  async update(id: string, dto: UpdateIpvDto): Promise<Ipv> {
    const actual = await this.ipvModel.findById(id).exec();
    if (!actual) {
      throw new NotFoundException('No se encontró la fila del IPV');
    }
    const fila = this.calcularFila({
      precioCosto: dto.precioCosto ?? actual.precioCosto,
      precioVenta: dto.precioVenta ?? actual.precioVenta,
      inventarioInicial: dto.inventarioInicial ?? actual.inventarioInicial,
      entradas: dto.entradas ?? actual.entradas,
      ajusteDisminucion: dto.ajusteDisminucion ?? actual.ajusteDisminucion,
      venta: dto.venta ?? actual.venta,
    });
    actual.set(fila);
    return actual.save();
  }

  async remove(id: string): Promise<void> {
    const eliminado = await this.ipvModel.findByIdAndDelete(id).exec();
    if (!eliminado) {
      throw new NotFoundException('No se encontró la fila del IPV');
    }
  }

  /** Elimina el IPV guardado del día para volver a los valores sugeridos. */
  async reset(fecha: string): Promise<{ fecha: string; eliminados: number }> {
    const fechaDia = normalizarFecha(fecha);
    const { deletedCount } = await this.ipvModel
      .deleteMany({ fecha: fechaDia })
      .exec();
    return { fecha: fechaDia, eliminados: deletedCount ?? 0 };
  }

  private calcularFila(m: MovimientosIpv) {
    const disponible = Math.max(
      0,
      m.inventarioInicial + m.entradas - m.ajusteDisminucion,
    );
    const inventarioFinal = Math.max(0, disponible - m.venta);
    return {
      precioCosto: m.precioCosto,
      precioVenta: m.precioVenta,
      inventarioInicial: m.inventarioInicial,
      entradas: m.entradas,
      ajusteDisminucion: m.ajusteDisminucion,
      venta: m.venta,
      disponible: this.redondear(disponible),
      inventarioFinal: this.redondear(inventarioFinal),
      importeVenta: this.redondear(m.precioVenta * m.venta),
      importeCosto: this.redondear(m.precioCosto * m.venta),
    };
  }

  private async calcularSugeridos(
    fecha: string,
    productoIds: Types.ObjectId[],
  ): Promise<Map<string, Partial<MovimientosIpv>>> {
    const { inicio, fin } = rangoDelDia(fecha);

    const [ventas, movimientos, anteriores] = await Promise.all([
      this.ventaModel
        .aggregate<{ _id: Types.ObjectId; cantidad: number }>([
          { $match: { createdAt: { $gte: inicio, $lte: fin } } },
          { $unwind: '$productos' },
          { $match: { 'productos.productoId': { $in: productoIds } } },
          {
            $group: {
              _id: '$productos.productoId',
              cantidad: { $sum: '$productos.cantidad' },
            },
          },
        ])
        .exec(),
      this.kardexModel
        .aggregate<{
          _id: { producto: Types.ObjectId; tipo: KardexTipo };
          cantidad: number;
        }>([
          {
            $match: {
              fecha: { $gte: inicio, $lte: fin },
              productoId: { $in: productoIds },
              tipo: { $in: [...TIPOS_ENTRADA, ...TIPOS_DISMINUCION] },
            },
          },
          {
            $group: {
              _id: { producto: '$productoId', tipo: '$tipo' },
              cantidad: { $sum: '$cantidad' },
            },
          },
        ])
        .exec(),
      this.ipvModel
        .aggregate<{ _id: Types.ObjectId; inventarioFinal: number }>([
          { $match: { fecha: { $lt: fecha }, producto: { $in: productoIds } } },
          { $sort: { fecha: -1 } },
          {
            $group: {
              _id: '$producto',
              inventarioFinal: { $first: '$inventarioFinal' },
            },
          },
        ])
        .exec(),
    ]);

    const resultado = new Map<string, Partial<MovimientosIpv>>();
    const obtener = (id: Types.ObjectId) => {
      const key = String(id);
      if (!resultado.has(key)) resultado.set(key, {});
      return resultado.get(key)!;
    };

    for (const v of ventas) obtener(v._id).venta = v.cantidad;
    for (const m of movimientos) {
      const fila = obtener(m._id.producto);
      if (TIPOS_ENTRADA.includes(m._id.tipo)) {
        fila.entradas = (fila.entradas ?? 0) + m.cantidad;
      } else {
        fila.ajusteDisminucion = (fila.ajusteDisminucion ?? 0) + m.cantidad;
      }
    }
    for (const a of anteriores) {
      obtener(a._id).inventarioInicial = a.inventarioFinal;
    }
    return resultado;
  }

  private redondear(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
}
