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

/**
 * Shape of `impuesto`, both as sent by the client (all fields optional,
 * `importe` only used as a fallback when `porciento` is absent) and as
 * returned by `calcularTotales` (the same shape, since `calcularImpuesto`
 * either recomputes `importe` from `porciento` or passes the client's
 * fields through unchanged) — one interface for both directions.
 */
export interface Impuesto {
  tipo?: string;
  porciento?: number;
  importe?: number;
}

export interface TotalesCalculados {
  items: ItemFacturaCalculado[];
  subtotal: number;
  descuentoTotal: number;
  recargoTotal: number;
  impuesto?: Impuesto;
  total: number;
}

/**
 * Rounds to 2 decimals, deterministically half-up in magnitude (never
 * banker's rounding), correcting for binary floating-point error such as
 * `2.675 * 100 === 267.49999999999997`. `toFixed(8)` re-snaps the scaled
 * value to the decimal the caller meant before `Math.round` decides the
 * half-up tie, and the sign is restored afterwards so negative values round
 * symmetrically (`-1.005` -> `-1.01`, not `-1`).
 */
export function redondear(n: number): number {
  const signo = n < 0 ? -1 : 1;
  const magnitudRedondeada =
    Math.round(Number((Math.abs(n) * 100).toFixed(8))) / 100;
  return signo * magnitudRedondeada;
}

export function calcularTotales(
  items: ItemFacturaEntrada[],
  impuesto: Impuesto | undefined,
): TotalesCalculados {
  let subtotal = 0;
  let descuentoTotal = 0;
  let recargoTotal = 0;

  const itemsCalculados: ItemFacturaCalculado[] = items.map((item) => {
    const gross = redondear(item.precio * item.cantidad);
    const rawDiscount = redondear(
      item.descuentoMonto + (gross * item.descuentoPct) / 100,
    );
    // Clamp the discount itself, not just the resulting total, so
    // `subtotal - descuentoTotal + recargoTotal === base` always holds
    // (an unclamped over-discount would inflate descuentoTotal beyond what
    // the clamped item totals actually reflect).
    const lineDiscount = Math.min(rawDiscount, redondear(gross + item.recargo));
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
  impuesto: Impuesto | undefined,
): Impuesto | undefined {
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
