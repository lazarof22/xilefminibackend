import { BadRequestException } from '@nestjs/common';

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha local del servidor en formato AAAA-MM-DD. */
export function fechaHoy(): string {
  return formatearFecha(new Date());
}

export function formatearFecha(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Normaliza una fecha recibida por query/body (AAAA-MM-DD o ISO) al formato
 * AAAA-MM-DD. Sin valor devuelve el día actual.
 */
export function normalizarFecha(fecha?: string): string {
  if (!fecha) return fechaHoy();
  if (FORMATO_FECHA.test(fecha)) return fecha;
  const parsed = new Date(fecha);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('La fecha no es válida (use AAAA-MM-DD)');
  }
  return formatearFecha(parsed);
}

/**
 * Rango [inicio, fin] del día en hora local. `new Date('AAAA-MM-DD')` se
 * interpreta en UTC, por eso se construye la fecha a partir de sus partes.
 */
export function rangoDelDia(fecha?: string): { inicio: Date; fin: Date } {
  const [y, m, d] = normalizarFecha(fecha).split('-').map(Number);
  const inicio = new Date(y, m - 1, d, 0, 0, 0, 0);
  const fin = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { inicio, fin };
}
