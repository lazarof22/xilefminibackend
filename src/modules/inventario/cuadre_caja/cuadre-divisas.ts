import { MONEDA_BASE, monedaDelPago } from '../pago/divisas';

/** Lo que el cuadre lee de un pago en efectivo (los pagos anteriores a la Fase 3 no traen moneda). */
export interface PagoEfectivoLeido {
  monto_pagado?: number;
  /** Cambio, en la moneda del pago. */
  cambio?: number;
  /** El cambio en `monedaCambio`, cuando difiere de la moneda del pago. */
  cambioConvertido?: number;
  moneda?: unknown;
  monedaCambio?: unknown;
}

/** Lo que una venta en efectivo mueve físicamente en la caja. */
export interface FlujoEfectivo {
  /** Moneda en la que entregó el dinero el cliente. */
  moneda: string;
  recibido: number;
  /** Moneda en la que se devolvió el cambio. */
  monedaCambio: string;
  /** Cambio que salió de la caja, en `monedaCambio`. */
  cambio: number;
  /** ¿Intervino alguna moneda distinta del CUP (al cobrar o al devolver)? */
  conDivisas: boolean;
}

/**
 * Entradas y salidas físicas de una venta en efectivo. Recibir USD y devolver
 * el cambio en CUP mueve dos cajas distintas: no basta convertir y sumar.
 */
export function flujoDeEfectivo(
  pago: PagoEfectivoLeido | undefined,
  totalVenta: number,
): FlujoEfectivo {
  const moneda = monedaDelPago(pago?.moneda);
  const monedaCambio = pago?.monedaCambio
    ? monedaDelPago(pago.monedaCambio)
    : moneda;
  const mismaMoneda = monedaCambio === moneda;

  return {
    moneda,
    // Un pago antiguo sin montos se toma como cobrado justo.
    recibido: pago?.monto_pagado ?? totalVenta,
    monedaCambio,
    cambio: mismaMoneda ? (pago?.cambio ?? 0) : (pago?.cambioConvertido ?? 0),
    conDivisas: moneda !== MONEDA_BASE || monedaCambio !== MONEDA_BASE,
  };
}

/**
 * Cuánto hay que sumar al efectivo esperado en CUP por una venta con divisas.
 *
 * El resumen cuenta cada venta en efectivo como si hubiera entrado su total en
 * CUP; esta diferencia lo corrige a lo que de verdad entró y salió en CUP:
 *   (CUP recibidos − CUP devueltos de cambio) − total de la venta.
 * Una venta en CUP de siempre no se corrige (0).
 */
export function ajusteDivisasCUP(
  flujo: FlujoEfectivo,
  totalVenta: number,
): number {
  if (!flujo.conDivisas) return 0;

  const entra = flujo.moneda === MONEDA_BASE ? flujo.recibido : 0;
  const sale = flujo.monedaCambio === MONEDA_BASE ? flujo.cambio : 0;

  return entra - sale - totalVenta;
}
