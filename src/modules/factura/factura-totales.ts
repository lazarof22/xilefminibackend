/**
 * Pure, server-side totals calculation for a Factura, matching the
 * formula used by the xilefminifrontend FacturacionTab so the client
 * preview and the persisted invoice always agree:
 *
 *   gross = precio * cantidad
 *   lineDiscount = descuentoMonto + gross * descuentoPct / 100
 *   item.total = max(0, gross - lineDiscount + recargo)
 *   subtotal = Σ gross; descuentoTotal = Σ lineDiscount; recargoTotal = Σ recargo
 *   base = Σ item.total
 *   impuesto.importe = base * porciento / 100 when porciento is set
 *   total = base + importe
 */

export interface ItemFacturaEntrada {
  id: string;
  productoId: string;
  productoNombre: string;
  unidadMedida?: string;
  cantidad: number;
  precio: number;
  costo: number;
  descuentoPct: number;
  descuentoMonto: number;
  recargo: number;
}

export interface ItemFacturaCalculado extends ItemFacturaEntrada {
  total: number;
}

export interface ImpuestoEntrada {
  tipo?: string;
  porciento?: number;
  importe?: number;
}

export interface ImpuestoCalculado {
  tipo?: string;
  porciento?: number;
  importe?: number;
}

export interface TotalesCalculados {
  items: ItemFacturaCalculado[];
  subtotal: number;
  descuentoTotal: number;
  recargoTotal: number;
  impuesto?: ImpuestoCalculado;
  total: number;
}

/** Rounds to 2 decimals, correcting for binary floating-point error. */
export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcularTotales(
  items: ItemFacturaEntrada[],
  impuesto: ImpuestoEntrada | undefined,
): TotalesCalculados {
  let subtotal = 0;
  let descuentoTotal = 0;
  let recargoTotal = 0;

  const itemsCalculados: ItemFacturaCalculado[] = items.map((item) => {
    const gross = redondear(item.precio * item.cantidad);
    const lineDiscount = redondear(
      item.descuentoMonto + (gross * item.descuentoPct) / 100,
    );
    const total = redondear(Math.max(0, gross - lineDiscount + item.recargo));

    subtotal = redondear(subtotal + gross);
    descuentoTotal = redondear(descuentoTotal + lineDiscount);
    recargoTotal = redondear(recargoTotal + item.recargo);

    return { ...item, total };
  });

  const base = redondear(
    itemsCalculados.reduce((acumulado, item) => acumulado + item.total, 0),
  );

  const impuestoCalculado = calcularImpuesto(base, impuesto);
  const total = redondear(base + (impuestoCalculado?.importe ?? 0));

  return {
    items: itemsCalculados,
    subtotal,
    descuentoTotal,
    recargoTotal,
    impuesto: impuestoCalculado,
    total,
  };
}

function calcularImpuesto(
  base: number,
  impuesto: ImpuestoEntrada | undefined,
): ImpuestoCalculado | undefined {
  if (!impuesto) {
    return undefined;
  }
  if (impuesto.porciento !== undefined) {
    return {
      tipo: impuesto.tipo,
      porciento: impuesto.porciento,
      importe: redondear((base * impuesto.porciento) / 100),
    };
  }
  if (impuesto.importe !== undefined) {
    return { tipo: impuesto.tipo, importe: impuesto.importe };
  }
  if (impuesto.tipo !== undefined) {
    return { tipo: impuesto.tipo };
  }
  return undefined;
}
