import type { DetalleEfectivoMoneda } from '../efectivo-turno.util';

export interface TotalesMetodo {
  efectivo: number;
  credito: number;
  transferencia: number;
  factura: number;
}

export interface ResumenReportePlus {
  /** Inicio del turno: cierre del último turno o inicio del día de la primera venta. */
  desde: Date;
  totalVentas: number;
  totalExtracciones: number;
  /**
   * @deprecated Mezcla efectivo, crédito, transferencia y factura en un solo
   * saldo (totalVentas - totalExtracciones). Usar `efectivoEsperado`,
   * `cuentasPorCobrar` y `cobrosElectronicos`.
   */
  saldoNeto: number;
  /**
   * Efectivo físico esperado por moneda = fondo inicial (turnos abiertos) +
   * efectivo recibido - cambio - devoluciones en efectivo - extracciones -
   * depósitos bancarios. Una venta a crédito no lo altera.
   */
  efectivoEsperado: Record<string, number>;
  /** Ventas a crédito - cobros aplicados, por moneda. */
  cuentasPorCobrar: Record<string, number>;
  /** Transferencias, por moneda. */
  cobrosElectronicos: Record<string, number>;
  /** Líneas de factura (no es un medio de cobro), por moneda; informativo. */
  facturado: Record<string, number>;
  detalleEfectivo: Record<string, DetalleEfectivoMoneda>;
  /** Pagos distintos hechos por transferencia (no filas). */
  cantidadTransferencias: number;
  porMetodo: TotalesMetodo;
  movimientos: number;
}

export interface CierreTurnoResultado {
  mensaje: string;
  movimientosKardex: number;
  filasEliminadas: number;
  resumen: ResumenReportePlus;
}
