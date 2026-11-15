import { Factura } from '../schema/factura.schema';
import { redondear } from '../factura-totales';

/** Identifier of the digital export document layout (internal, versioned). */
export const FORMATO_FACTURA_DIGITAL = 'factura-digital/1';

export interface FacturaDigitalItem {
  producto: string;
  cantidad: number;
  precio: number;
  /** Line discount: fixed amount plus the percentage applied to the gross. */
  descuento: number;
  recargo: number;
  total: number;
}

export interface FacturaDigital {
  formato: typeof FORMATO_FACTURA_DIGITAL;
  numero: number;
  estado: string;
  fecha: string;
  /** Issuer snapshot stored in the invoice at emission time. */
  emisor?: Record<string, unknown>;
  cliente: {
    nombre: string;
    nit?: string;
    direccion?: string;
    telefono?: string;
    email?: string;
  };
  items: FacturaDigitalItem[];
  totales: {
    subtotal: number;
    descuentoTotal: number;
    recargoTotal: number;
    impuesto: number;
    total: number;
  };
  facturadoPor?: string;
  /** Only present for a `cancelada`/`anulada` invoice that stored its reason. */
  anulacion?: {
    motivo?: string;
    anuladaPor?: { userId: string; nombre: string };
    fecha?: Date;
  };
}

/** Plain copy of a stored subdocument (works for lean objects and documents). */
function comoObjetoPlano(valor: unknown): Record<string, unknown> | undefined {
  if (!valor || typeof valor !== 'object') return undefined;
  const origen = valor as { toObject?: () => Record<string, unknown> };
  return typeof origen.toObject === 'function'
    ? origen.toObject()
    : { ...(valor as Record<string, unknown>) };
}

/**
 * Pure mapping of a stored invoice to the digital export document
 * (`GET /facturas/:id/exportar`). Only data already stored in the invoice is
 * used; internal bookkeeping (costs, product ids, inventory flags, revision)
 * is never exposed. This layout is internal: it makes no claim of conformity
 * with any official electronic invoice format.
 */
export function exportarFactura(factura: Factura): FacturaDigital {
  const anulada =
    factura.motivoAnulacion !== undefined ||
    factura.anuladaPor !== undefined ||
    factura.fechaAnulacion !== undefined;

  const doc: FacturaDigital = {
    formato: FORMATO_FACTURA_DIGITAL,
    numero: factura.numero,
    estado: factura.estado,
    fecha: factura.fecha,
    emisor: comoObjetoPlano(factura.emisor),
    cliente: {
      nombre: factura.cliente,
      nit: factura.nit,
      direccion: factura.direccion,
      telefono: factura.telefono,
      email: factura.email,
    },
    items: factura.items.map((item) => ({
      producto: item.productoNombre,
      cantidad: item.cantidad,
      precio: item.precio,
      descuento: redondear(
        item.descuentoMonto +
          (item.precio * item.cantidad * item.descuentoPct) / 100,
      ),
      recargo: item.recargo,
      total: item.total,
    })),
    totales: {
      subtotal: factura.subtotal,
      descuentoTotal: factura.descuentoTotal,
      recargoTotal: factura.recargoTotal,
      impuesto: factura.impuesto?.importe ?? 0,
      total: factura.total,
    },
    facturadoPor: factura.facturadoPor?.nombre,
  };

  if (anulada) {
    doc.anulacion = {
      motivo: factura.motivoAnulacion,
      anuladaPor: factura.anuladaPor
        ? {
            userId: factura.anuladaPor.userId,
            nombre: factura.anuladaPor.nombre,
          }
        : undefined,
      fecha: factura.fechaAnulacion,
    };
  }

  return doc;
}
