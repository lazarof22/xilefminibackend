import { MetodoPagoReporte, OrigenReporte } from './schema/reporte_plus.schema';
import {
  flujoDeEfectivo,
  PagoEfectivoLeido,
} from '../cuadre_caja/cuadre-divisas';

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

/**
 * Conserva los movimientos que cuentan para el efectivo esperado: los de un
 * turno de caja ABIERTO y los que no pertenecen a ningún turno (anteriores a
 * los turnos: siguen contando por la ventana de tiempo). Lo de un turno ya
 * cerrado se descarta: su fondo ya no está en la caja y su efectivo se
 * cuadró al cerrarlo (doc §6.6), así que restarlo daría un esperado negativo.
 */
export function soloDeTurnosAbiertos<T>(
  movimientos: T[],
  turnoDe: (movimiento: T) => unknown,
  turnosAbiertos: ReadonlySet<string>,
): T[] {
  return movimientos.filter((m) => {
    const turno = turnoDe(m);
    if (turno === undefined || turno === null || turno === '') return true;
    return turnosAbiertos.has(String(turno));
  });
}

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

/**
 * Dinero físico que una venta movió en UNA moneda: lo recibido y el cambio
 * entregado (doc §6.6). Una venta con divisas produce uno o dos de estos.
 */
export interface FlujoFisico {
  moneda: string;
  recibido: number;
  cambio: number;
}

/** Fila de venta del Reporte Plus con lo necesario para localizar su pago. */
export interface FilaVenta extends FilaMoneda {
  origen?: OrigenReporte;
  /** Id de la venta (POS) o número de factura. */
  referencia?: string;
}

interface PagoLeido extends PagoEfectivoLeido {
  _id: unknown;
  metodoPago?: string;
  esCuentaCasa?: boolean;
}

/** Cadena de lectura de Mongoose (`find().select().lean().exec()`) reducida a lo que se usa. */
interface ConsultaLectura {
  select(campos: string): ConsultaLectura;
  lean(): ConsultaLectura;
  exec(): Promise<unknown>;
}

/** Lo que `resolverFlujosFisicos` necesita de un modelo Mongoose. */
interface ModeloLectura {
  find(filtro: Record<string, unknown>): ConsultaLectura;
}

/**
 * Corrige el efectivo de las ventas hechas con divisas. Las filas del Reporte
 * Plus no saben en qué moneda entregó el dinero el cliente ni en cuál se
 * devolvió el cambio (el checkout las escribe en CUP): una venta de 1600 CUP
 * pagada con 5 USD figuraría como +1600 CUP y +0 USD. Aquí se lee el `Pago`
 * de cada venta (fila de origen venta → `referencia` = id de la venta →
 * `Venta.pago`) y se obtiene, por moneda física, lo recibido y el cambio
 * entregado (`flujoDeEfectivo`).
 *
 * Devuelve las filas SIN las ventas corregidas y los flujos físicos que las
 * sustituyen. Una venta en CUP de siempre, a crédito, por transferencia, de
 * cuenta casa, o cuya venta/pago no se encuentra, conserva su comportamiento
 * por filas. Nunca lanza: si la lectura falla se devuelven las filas tal cual.
 */
export async function resolverFlujosFisicos<F extends FilaVenta>(
  filas: F[],
  ventaModel?: ModeloLectura,
  pagoModel?: ModeloLectura,
  alFallar?: (error: unknown) => void,
): Promise<{ filas: F[]; flujos: FlujoFisico[] }> {
  const sinCambios = { filas, flujos: [] as FlujoFisico[] };
  if (!ventaModel || !pagoModel) return sinCambios;

  // Total cobrado en efectivo por venta (suma de sus líneas).
  const totales = new Map<string, number>();
  for (const f of filas) {
    if (f.metodoPago !== MetodoPagoReporte.EFECTIVO) continue;
    if (f.origen !== undefined && f.origen !== OrigenReporte.VENTA) continue;
    if (!f.referencia || !ID_MONGO.test(f.referencia)) continue;
    totales.set(f.referencia, (totales.get(f.referencia) ?? 0) + f.total);
  }
  if (totales.size === 0) return sinCambios;

  try {
    const ventas = (await ventaModel
      .find({ _id: { $in: [...totales.keys()] } })
      .select('pago')
      .lean()
      .exec()) as { _id: unknown; pago?: { toString(): string } }[];
    const pagoDeVenta = new Map<string, string>();
    for (const v of ventas ?? [])
      if (v?.pago) pagoDeVenta.set(String(v._id), v.pago.toString());
    if (pagoDeVenta.size === 0) return sinCambios;

    const pagos = (await pagoModel
      .find({ _id: { $in: [...new Set(pagoDeVenta.values())] } })
      .lean()
      .exec()) as PagoLeido[];
    const pagoPorId = new Map<string, PagoLeido>();
    for (const p of pagos ?? []) if (p) pagoPorId.set(String(p._id), p);

    const flujos: FlujoFisico[] = [];
    const reemplazadas = new Set<string>();
    for (const [venta, total] of totales) {
      const pago = pagoPorId.get(pagoDeVenta.get(venta) ?? '');
      if (!pago) continue;
      if (
        pago.metodoPago === 'transferencia' ||
        pago.metodoPago === 'credito' ||
        pago.esCuentaCasa
      )
        continue;
      const flujo = flujoDeEfectivo(pago, redondear(total));
      // Venta en CUP de siempre: las filas ya son correctas.
      if (!flujo.conDivisas) continue;
      flujos.push({
        moneda: flujo.moneda,
        recibido: flujo.recibido,
        cambio: 0,
      });
      flujos.push({
        moneda: flujo.monedaCambio,
        recibido: 0,
        cambio: flujo.cambio,
      });
      reemplazadas.add(venta);
    }
    if (reemplazadas.size === 0) return sinCambios;

    return {
      filas: filas.filter(
        (f) =>
          !(
            f.metodoPago === MetodoPagoReporte.EFECTIVO &&
            (f.origen === undefined || f.origen === OrigenReporte.VENTA) &&
            f.referencia !== undefined &&
            reemplazadas.has(f.referencia)
          ),
      ),
      flujos,
    };
  } catch (error) {
    alFallar?.(error);
    return sinCambios;
  }
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
  /**
   * Efectivo físico de ventas con divisas (ver `resolverFlujosFisicos`):
   * se suma al recibido y al cambio entregado de cada moneda, además de las
   * filas de efectivo.
   */
  flujosFisicos?: FlujoFisico[];
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

  const cambioEntregado: Record<string, number> = {};
  for (const fl of e.flujosFisicos ?? []) {
    const k = fl.moneda || MONEDA_POR_DEFECTO;
    efectivo[k] = (efectivo[k] ?? 0) + fl.recibido;
    cambioEntregado[k] = (cambioEntregado[k] ?? 0) + fl.cambio;
  }

  const extracciones = sumarPorMoneda(e.extracciones);
  const depositos = sumarPorMoneda(e.depositos);
  const devoluciones = sumarPorMoneda(e.devolucionesEfectivo);
  const cobros = sumarPorMoneda(e.cobrosAplicados);

  const monedas = new Set<string>([
    MONEDA_POR_DEFECTO,
    ...Object.keys(e.fondoInicial),
    ...Object.keys(efectivo),
    ...Object.keys(cambioEntregado),
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
      cambioEntregado: redondear(cambioEntregado[k] ?? 0),
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
