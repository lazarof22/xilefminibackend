import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Venta } from '../venta/schema/venta.schema';
import { Pago } from '../pago/schema/pago.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { RegistroCompra } from '../registro-compra/schema/registro-compra.schema';
import { Factura } from '../../factura/schema/factura.schema';
import { EstadoFactura, TipoPago } from '../../factura/factura.constants';
import {
  UbicacionCantidad,
  aObjectId,
  redondear,
} from '../exitencia/existencia.types';
import { fusionarOrigen } from './devolucion-ubicaciones';
import {
  DevolucionOrigenTipo,
  DevolucionTipo,
  FormaDevolucionDinero,
} from './schema/devolucion.schema';

/** Lo que un documento de origen tiene de un producto, listo para devolverlo. */
export interface ProductoOrigen {
  /** Id del producto en hexadecimal minúscula. */
  productoId: string;
  /** Cantidad vendida (o comprada) en el origen: tope acumulado de devoluciones. */
  vendida: number;
  /** Precio neto unitario del origen (descuentos aplicados, sin impuesto). */
  precioUnitario: number;
  /** Ubicaciones de las que salió (venta/factura) o en las que quedó (compra). */
  ubicaciones: UbicacionCantidad[];
}

/** Documento de origen ya validado, con todo lo que el servidor deduce de él. */
export interface OrigenResuelto {
  tipo: DevolucionTipo;
  origenTipo: DevolucionOrigenTipo;
  origenId: Types.ObjectId;
  productos: Map<string, ProductoOrigen>;
  /** Multiplicador del impuesto del origen sobre el neto de cada línea (1 = sin impuesto). */
  factorImpuesto: number;
  moneda: string;
  clienteId?: Types.ObjectId;
  /** Forma del dinero que corresponde al pago original; solo en devoluciones de venta. */
  formaDinero?: FormaDevolucionDinero;
  /** Pago original, para mensajes de error. */
  pagoOriginal?: string;
}

/** Redondeo a centavos para importes de dinero. */
export const redondear2 = (v: number): number =>
  Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Regla del doc §7.3: el dinero solo se devuelve si el pago original se
 * cobró. Efectivo cobrado -> efectivo; transferencia -> nota de crédito;
 * crédito (o cuenta casa, que no cobra nada) -> se descuenta la deuda.
 */
export function formaDineroDelPago(
  metodoPago: string | undefined,
  esCuentaCasa = false,
): FormaDevolucionDinero | undefined {
  if (metodoPago === 'credito' || (metodoPago === 'efectivo' && esCuentaCasa)) {
    return FormaDevolucionDinero.DESCUENTA_DEUDA;
  }
  if (metodoPago === 'efectivo') return FormaDevolucionDinero.EFECTIVO;
  if (metodoPago === 'transferencia') return FormaDevolucionDinero.NOTA_CREDITO;
  return undefined;
}

interface LineaCruda {
  productoId: unknown;
  cantidad: number;
  neto: number;
  ubicaciones?: { almacen: unknown; contenedor: unknown; cantidad: number }[];
}

/**
 * Localiza y valida el documento de origen de una devolución (Venta,
 * Factura o RegistroCompra) y extrae, solo en lectura, lo que el servidor
 * necesita: qué se vendió, a qué precio, de dónde salió y cómo se pagó.
 * Nunca escribe en `venta`, `pago` ni `factura`.
 */
@Injectable()
export class DevolucionOrigenService {
  constructor(
    @InjectModel(Venta.name) private readonly ventaModel: Model<Venta>,
    @InjectModel(Factura.name) private readonly facturaModel: Model<Factura>,
    @InjectModel(RegistroCompra.name)
    private readonly registroCompraModel: Model<RegistroCompra>,
    @InjectModel(Producto.name) private readonly productoModel: Model<Producto>,
    @InjectModel(Pago.name) private readonly pagoModel: Model<Pago>,
  ) {}

  async resolver(
    tipo: DevolucionTipo,
    origenTipo: DevolucionOrigenTipo,
    origenRef: string,
  ): Promise<OrigenResuelto> {
    const permitido =
      tipo === DevolucionTipo.PROVEEDOR
        ? origenTipo === DevolucionOrigenTipo.REGISTRO_COMPRA
        : origenTipo !== DevolucionOrigenTipo.REGISTRO_COMPRA;

    if (!permitido) {
      throw new BadRequestException(
        tipo === DevolucionTipo.PROVEEDOR
          ? 'Una devolución a proveedor referencia una compra (registro_compra)'
          : 'Una devolución de venta referencia una venta o una factura',
      );
    }

    if (!Types.ObjectId.isValid(origenRef)) {
      throw new BadRequestException('El origen de la devolución no es válido');
    }
    const origenId = new Types.ObjectId(origenRef);

    switch (origenTipo) {
      case DevolucionOrigenTipo.VENTA:
        return this.deVenta(origenId);
      case DevolucionOrigenTipo.FACTURA:
        return this.deFactura(origenId);
      default:
        return this.deCompra(origenId);
    }
  }

  private async deVenta(origenId: Types.ObjectId): Promise<OrigenResuelto> {
    const venta = await this.ventaModel.findById(origenId).lean().exec();
    if (!venta) {
      throw new NotFoundException('La venta de origen no existe');
    }

    const pago = venta.pago
      ? ((await this.pagoModel.findById(venta.pago).lean().exec()) as {
          metodoPago?: string;
          esCuentaCasa?: boolean;
          clienteId?: Types.ObjectId;
        } | null)
      : null;
    const formaDinero = formaDineroDelPago(
      pago?.metodoPago,
      pago?.esCuentaCasa,
    );

    if (!formaDinero) {
      throw new ConflictException(
        'No se puede determinar cómo se pagó la venta de origen; no hay forma segura de devolver el dinero',
      );
    }

    // Una venta del checkout guarda lo cobrado por línea (`subtotal`): se usa
    // ese importe. Las ventas anteriores no lo guardan; para ellas se toma el
    // precio de venta actual del producto menos el descuento de la línea.
    const precios = await this.preciosDe(
      venta.productos.map((p) => String(p.productoId)),
    );
    const lineas: LineaCruda[] = venta.productos.map((p) => ({
      productoId: p.productoId,
      cantidad: p.cantidad,
      neto: Math.max(
        0,
        (typeof p.subtotal === 'number'
          ? p.subtotal
          : (precios.get(this.hex(p.productoId)) ?? 0) * p.cantidad) -
          (p.descuentoMonto ?? 0),
      ),
      ubicaciones: p.ubicaciones,
    }));
    const productos = this.agrupar(lineas);
    const netoTotal = [...lineas].reduce((s, l) => s + l.neto, 0);

    return {
      tipo: DevolucionTipo.VENTA,
      origenTipo: DevolucionOrigenTipo.VENTA,
      origenId,
      productos,
      factorImpuesto: netoTotal > 0 ? 1 + (venta.impuesto ?? 0) / netoTotal : 1,
      moneda: 'CUP',
      clienteId: aObjectId(pago?.clienteId),
      formaDinero,
      pagoOriginal: pago?.metodoPago,
    };
  }

  /**
   * Second look at the origin AFTER the vale is persisted. A factura can be
   * claimed by `cancelar` between `resolver` and the vale insert; the cancel
   * side re-checks for vales after its own claim, so whichever write comes
   * second sees the other and backs off.
   */
  async sigueVigente(origen: OrigenResuelto): Promise<boolean> {
    if (origen.origenTipo !== DevolucionOrigenTipo.FACTURA) return true;
    const factura = await this.facturaModel
      .findById(origen.origenId)
      .lean()
      .exec();
    return (
      !!factura &&
      factura.estado === EstadoFactura.CONFIRMADA &&
      factura.inventarioAplicado === true &&
      factura.inventarioEnProceso !== true
    );
  }

  private async deFactura(origenId: Types.ObjectId): Promise<OrigenResuelto> {
    const factura = await this.facturaModel.findById(origenId).lean().exec();
    if (!factura) {
      throw new NotFoundException('La factura de origen no existe');
    }
    if (
      factura.estado !== EstadoFactura.CONFIRMADA ||
      factura.inventarioAplicado !== true
    ) {
      throw new ConflictException(
        `Solo se devuelve mercancía de una factura confirmada cuyo inventario se descontó (estado actual: ${factura.estado})`,
      );
    }

    const formaDinero = formaDineroDelPago(
      factura.metodoPago === TipoPago.CREDITO
        ? 'credito'
        : factura.metodoPago === TipoPago.TRANSFERENCIA
          ? 'transferencia'
          : 'efectivo',
    );

    const lineas: LineaCruda[] = factura.items.map((i) => ({
      productoId: i.productoId,
      cantidad: i.cantidad,
      neto: Math.max(0, i.total),
    }));
    const productos = this.agrupar(lineas);

    // Las ubicaciones de la factura vienen aparte, por producto.
    for (const [id, p] of productos) {
      p.ubicaciones = fusionarOrigen(
        (factura.inventarioUbicaciones ?? [])
          .filter((u) => this.hex(u.productoId) === id)
          .map((u) => ({
            almacen: u.almacen,
            contenedor: u.contenedor,
            cantidad: u.cantidad,
          })),
      );
    }

    const netoTotal = lineas.reduce((s, l) => s + l.neto, 0);

    return {
      tipo: DevolucionTipo.VENTA,
      origenTipo: DevolucionOrigenTipo.FACTURA,
      origenId,
      productos,
      factorImpuesto:
        netoTotal > 0 ? Math.max(0, factura.total) / netoTotal : 1,
      moneda: factura.moneda || 'CUP',
      clienteId: aObjectId(factura.clienteId),
      formaDinero,
      pagoOriginal: factura.metodoPago,
    };
  }

  private async deCompra(origenId: Types.ObjectId): Promise<OrigenResuelto> {
    const compra = await this.registroCompraModel
      .findById(origenId)
      .lean()
      .exec();
    if (!compra) {
      throw new NotFoundException('La compra de origen no existe');
    }

    const id = this.hex(compra.producto);
    const productos = new Map<string, ProductoOrigen>([
      [
        id,
        {
          productoId: id,
          vendida: compra.cantidad,
          precioUnitario: compra.costo_unitario,
          // La mercancía comprada quedó en esta ubicación: de ahí sale.
          ubicaciones: fusionarOrigen([
            {
              almacen: compra.almacen,
              contenedor: compra.contenedor,
              cantidad: compra.cantidad,
            },
          ]),
        },
      ],
    ]);

    return {
      tipo: DevolucionTipo.PROVEEDOR,
      origenTipo: DevolucionOrigenTipo.REGISTRO_COMPRA,
      origenId,
      productos,
      factorImpuesto: 1,
      moneda: 'CUP',
    };
  }

  /** Suma las líneas de un mismo producto: cantidad, neto unitario medio y ubicaciones. */
  private agrupar(lineas: LineaCruda[]): Map<string, ProductoOrigen> {
    const acumulado = new Map<
      string,
      {
        cantidad: number;
        neto: number;
        filas: NonNullable<LineaCruda['ubicaciones']>;
      }
    >();

    for (const l of lineas) {
      const id = this.hex(l.productoId);
      const actual = acumulado.get(id) ?? { cantidad: 0, neto: 0, filas: [] };
      actual.cantidad = redondear(actual.cantidad + l.cantidad);
      actual.neto += l.neto;
      actual.filas.push(...(l.ubicaciones ?? []));
      acumulado.set(id, actual);
    }

    return new Map(
      [...acumulado].map(([id, a]) => [
        id,
        {
          productoId: id,
          vendida: a.cantidad,
          precioUnitario: a.cantidad > 0 ? redondear(a.neto / a.cantidad) : 0,
          ubicaciones: fusionarOrigen(a.filas),
        },
      ]),
    );
  }

  private async preciosDe(ids: string[]): Promise<Map<string, number>> {
    const productos = await this.productoModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('precio_venta')
      .lean()
      .exec();
    return new Map(
      productos.map((p) => [this.hex(p._id), Number(p.precio_venta) || 0]),
    );
  }

  private hex(valor: unknown): string {
    const id = aObjectId(valor);
    return id ? id.toHexString() : String(valor).toLowerCase();
  }
}
