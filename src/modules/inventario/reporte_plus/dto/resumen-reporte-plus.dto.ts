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
  /** totalVentas - totalExtracciones. */
  saldoNeto: number;
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
