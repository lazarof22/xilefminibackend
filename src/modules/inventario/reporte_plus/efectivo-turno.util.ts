import { MetodoPagoReporte } from './schema/reporte_plus.schema';

/** Moneda que se asume cuando el pago o el movimiento no informa ninguna. */
export const MONEDA_POR_DEFECTO = 'CUP';

const ID_MONGO = /^[0-9a-f]{24}$/i;

/** Redondeo a 2 decimales (evita 0.1 + 0.2 = 0.30000000000000004). */
export const redondear = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Único punto por el que Caja lee la moneda de un pago. Hoy el pago casi
 * nunca la trae (devuelve CUP); cuando la fase 3 guarde la moneda por pago,
 * solo cambia esta función.
 */
export const monedaDelPago = (pago?: { moneda?: unknown } | null): string => {
  const moneda = pago?.moneda;
  if (moneda === undefined || moneda === null || moneda === '')
    return MONEDA_POR_DEFECTO;
  // Hoy `PagoEfectivo.moneda` puede ser el id de un Moneda (ObjectId o su
  // texto): sin la fase 3 no hay forma de traducirlo a código, y el monto de
  // la venta ya está en CUP.
  if (typeof moneda !== 'string') return MONEDA_POR_DEFECTO;
  return ID_MONGO.test(moneda) ? MONEDA_POR_DEFECTO : moneda;
};

/** Movimiento de dinero físico en una moneda (extracción, depósito, cobro...). */
export interface MovimientoMoneda {
  monto: number;
  moneda?: string;
}

/** Fila de venta reducida a lo que Caja necesita. */
export interface FilaMoneda {
  metodoPago: MetodoPagoReporte;
  total: number;
  moneda?: string;
}

export interface EntradaEfectivoEsperado {
  fondoInicial: number;
  efectivoRecibido?: number;
  cambioEntregado?: number;
  devolucionesEfectivo?: number;
  extracciones?: number;
  depositosBancarios?: number;
}

/**
 * Efectivo esperado de UNA moneda física (doc §6.6):
 * fondo inicial + entradas físicas − salidas físicas, donde las entradas son
 * el efectivo recibido y las salidas el cambio entregado, las devoluciones en
 * efectivo, las extracciones y los depósitos bancarios.
 */
export function calcularEfectivoEsperado(e: EntradaEfectivoEsperado): number {
  return redondear(
    e.fondoInicial +
      (e.efectivoRecibido ?? 0) -
      (e.cambioEntregado ?? 0) -
      (e.devolucionesEfectivo ?? 0) -
      (e.extracciones ?? 0) -
      (e.depositosBancarios ?? 0),
  );
}

export interface DetalleEfectivoMoneda {
  fondoInicial: number;
  efectivoRecibido: number;
  cambioEntregado: number;
  devolucionesEfectivo: number;
  extracciones: number;
  depositosBancarios: number;
  efectivoEsperado: number;
}

export interface ResumenMonedas {
  /** Efectivo físico esperado por moneda. */
  efectivoEsperado: Record<string, number>;
  /** Ventas a crédito − cobros aplicados, por moneda. */
  cuentasPorCobrar: Record<string, number>;
  /** Transferencias (cobros electrónicos), por moneda. */
  cobrosElectronicos: Record<string, number>;
  /** Líneas de factura sin medio de cobro conocido (informativo, no es dinero en caja). */
  facturado: Record<string, number>;
  detalleEfectivo: Record<string, DetalleEfectivoMoneda>;
}

export interface EntradaResumenMonedas {
  fondoInicial: Record<string, number>;
  filas: FilaMoneda[];
  extracciones: MovimientoMoneda[];
  depositos: MovimientoMoneda[];
  devolucionesEfectivo?: MovimientoMoneda[];
  cobrosAplicados?: MovimientoMoneda[];
}

const sumarPorMoneda = (
  movimientos: MovimientoMoneda[] | undefined,
): Record<string, number> => {
  const r: Record<string, number> = {};
  for (const m of movimientos ?? []) {
    const k = m.moneda || MONEDA_POR_DEFECTO;
    r[k] = (r[k] ?? 0) + m.monto;
  }
  return r;
};

/**
 * Separa lo que el turno mezclaba en un único saldo: efectivo físico,
 * cuentas por cobrar y cobros electrónicos, siempre POR MONEDA (nunca se
 * suman monedas distintas). Una venta a crédito no mueve el efectivo; una
 * línea de factura no es un medio de cobro.
 */
export function resumirPorMoneda(e: EntradaResumenMonedas): ResumenMonedas {
  const efectivo: Record<string, number> = {};
  const credito: Record<string, number> = {};
  const transferencia: Record<string, number> = {};
  const facturado: Record<string, number> = {};
  const destino: Record<MetodoPagoReporte, Record<string, number>> = {
    [MetodoPagoReporte.EFECTIVO]: efectivo,
    [MetodoPagoReporte.CREDITO]: credito,
    [MetodoPagoReporte.TRANSFERENCIA]: transferencia,
    [MetodoPagoReporte.FACTURA]: facturado,
  };
  for (const f of e.filas) {
    const k = f.moneda || MONEDA_POR_DEFECTO;
    const acum = destino[f.metodoPago];
    acum[k] = (acum[k] ?? 0) + f.total;
  }

  const extracciones = sumarPorMoneda(e.extracciones);
  const depositos = sumarPorMoneda(e.depositos);
  const devoluciones = sumarPorMoneda(e.devolucionesEfectivo);
  const cobros = sumarPorMoneda(e.cobrosAplicados);

  const monedas = new Set<string>([
    MONEDA_POR_DEFECTO,
    ...Object.keys(e.fondoInicial),
    ...Object.keys(efectivo),
    ...Object.keys(credito),
    ...Object.keys(transferencia),
    ...Object.keys(facturado),
    ...Object.keys(extracciones),
    ...Object.keys(depositos),
    ...Object.keys(devoluciones),
    ...Object.keys(cobros),
  ]);

  const r: ResumenMonedas = {
    efectivoEsperado: {},
    cuentasPorCobrar: {},
    cobrosElectronicos: {},
    facturado: {},
    detalleEfectivo: {},
  };
  for (const k of [...monedas].sort()) {
    const detalle: DetalleEfectivoMoneda = {
      fondoInicial: redondear(e.fondoInicial[k] ?? 0),
      efectivoRecibido: redondear(efectivo[k] ?? 0),
      cambioEntregado: 0,
      devolucionesEfectivo: redondear(devoluciones[k] ?? 0),
      extracciones: redondear(extracciones[k] ?? 0),
      depositosBancarios: redondear(depositos[k] ?? 0),
      efectivoEsperado: 0,
    };
    detalle.efectivoEsperado = calcularEfectivoEsperado(detalle);
    r.detalleEfectivo[k] = detalle;
    r.efectivoEsperado[k] = detalle.efectivoEsperado;
    r.cuentasPorCobrar[k] = redondear((credito[k] ?? 0) - (cobros[k] ?? 0));
    r.cobrosElectronicos[k] = redondear(transferencia[k] ?? 0);
    r.facturado[k] = redondear(facturado[k] ?? 0);
  }
  return r;
}
