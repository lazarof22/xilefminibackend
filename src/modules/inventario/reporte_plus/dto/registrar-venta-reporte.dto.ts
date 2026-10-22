import {
  MetodoPagoReporte,
  OrigenReporte,
} from '../schema/reporte_plus.schema';

/** Línea que otros módulos (venta, factura) entregan al Reporte Plus. */
export interface LineaReportePlus {
  productoId: string;
  codigo: string;
  nombre: string;
  cantidadVendida: number;
  stockFinal: number;
  metodoPago: MetodoPagoReporte;
  total: number;
  descuento: number;
  impuesto: number;
  origen: OrigenReporte;
  referencia: string;
  enKardex: boolean;
  fecha?: Date;
}
