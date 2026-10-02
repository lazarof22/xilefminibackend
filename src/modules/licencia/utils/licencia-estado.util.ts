import { LicenciaPayloadV3 } from '../services/payload-builder';
import { CLOCK_TOLERANCE_MS } from '../constants/licencia.constants';

/**
 * Status codes. Derived on every check from the SIGNED payload + the current
 * time; unsigned database fields are never trusted to make a license valid.
 */
export const ESTADO_CODIGOS = [
  'valida',
  'sin_licencia',
  'version_no_soportada',
  'formato_invalido',
  'firma_invalida',
  'hardware_no_coincide',
  'empresa_no_coincide',
  'reloj_alterado',
  'estado_alterado',
  'revocada',
  'inactiva',
  'no_iniciada',
  'expirada',
  'error_interno',
] as const;

export type EstadoCodigo = (typeof ESTADO_CODIGOS)[number];

export interface ContextoEvaluacion {
  ahoraMs: number;
  fingerprint: string;
  empresaId?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Derives the status of an ALREADY signature-verified payload. Order matters:
 * binding checks first, then clock floor, then revocation, then dates.
 * Perpetual licenses (`tipo: 'perpetua'`, `fecha_vencimiento: null`) never
 * expire. There is no grace period.
 */
export function derivarCodigo(
  p: LicenciaPayloadV3,
  ctx: ContextoEvaluacion,
): EstadoCodigo {
  if (p.hardware_fingerprint !== ctx.fingerprint) return 'hardware_no_coincide';
  if (ctx.empresaId !== undefined && p.empresa_id !== ctx.empresaId) {
    return 'empresa_no_coincide';
  }
  if (ctx.ahoraMs < Date.parse(p.emitida_en) - CLOCK_TOLERANCE_MS) {
    return 'reloj_alterado';
  }
  if (p.revocada) return 'revocada';
  if (!p.activa) return 'inactiva';
  if (ctx.ahoraMs < Date.parse(p.fecha_inicio)) return 'no_iniciada';
  if (
    p.fecha_vencimiento !== null &&
    ctx.ahoraMs > Date.parse(p.fecha_vencimiento)
  ) {
    return 'expirada';
  }
  return 'valida';
}

/** Remaining whole days (rounded up, >= 0); `null` for perpetual licenses. */
export function diasRestantes(
  p: LicenciaPayloadV3,
  ahoraMs: number,
): number | null {
  if (p.fecha_vencimiento === null) return null;
  const diff = Date.parse(p.fecha_vencimiento) - ahoraMs;
  return Math.max(0, Math.ceil(diff / DAY_MS));
}
