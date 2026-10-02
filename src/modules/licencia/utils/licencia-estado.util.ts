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

interface FechasPayload {
  emitidaMs: number;
  inicioMs: number;
  /** `null` for perpetual licenses. */
  vencimientoMs: number | null;
}

/** Parses the payload dates; `null` when any of them is unparseable. */
function parsearFechas(p: LicenciaPayloadV3): FechasPayload | null {
  const emitidaMs = Date.parse(p.emitida_en);
  const inicioMs = Date.parse(p.fecha_inicio);
  const vencimientoMs =
    p.fecha_vencimiento === null ? null : Date.parse(p.fecha_vencimiento);
  if (
    !Number.isFinite(emitidaMs) ||
    !Number.isFinite(inicioMs) ||
    (vencimientoMs !== null && !Number.isFinite(vencimientoMs))
  ) {
    return null;
  }
  return { emitidaMs, inicioMs, vencimientoMs };
}

/**
 * Derives the status of an ALREADY signature-verified payload. Order matters:
 * input sanity first (non-finite clock → `error_interno`, unparseable date →
 * `formato_invalido`; NaN comparisons are always false and would otherwise
 * fall through to `valida`), then binding checks, clock floor, revocation,
 * dates. Perpetual licenses (`tipo: 'perpetua'`, `fecha_vencimiento: null`)
 * never expire. There is no grace period.
 */
export function derivarCodigo(
  p: LicenciaPayloadV3,
  ctx: ContextoEvaluacion,
): EstadoCodigo {
  if (!Number.isFinite(ctx.ahoraMs)) return 'error_interno';
  const fechas = parsearFechas(p);
  if (fechas === null) return 'formato_invalido';
  if (p.hardware_fingerprint !== ctx.fingerprint) return 'hardware_no_coincide';
  if (ctx.empresaId !== undefined && p.empresa_id !== ctx.empresaId) {
    return 'empresa_no_coincide';
  }
  if (ctx.ahoraMs < fechas.emitidaMs - CLOCK_TOLERANCE_MS) {
    return 'reloj_alterado';
  }
  if (p.revocada) return 'revocada';
  if (!p.activa) return 'inactiva';
  if (ctx.ahoraMs < fechas.inicioMs) return 'no_iniciada';
  if (fechas.vencimientoMs !== null && ctx.ahoraMs > fechas.vencimientoMs) {
    return 'expirada';
  }
  return 'valida';
}

/**
 * Remaining whole days (rounded up, >= 0); `null` for perpetual licenses.
 * Never NaN: an unparseable date or non-finite clock yields `0`.
 */
export function diasRestantes(
  p: LicenciaPayloadV3,
  ahoraMs: number,
): number | null {
  if (p.fecha_vencimiento === null) return null;
  const diff = Date.parse(p.fecha_vencimiento) - ahoraMs;
  if (!Number.isFinite(diff)) return 0;
  return Math.max(0, Math.ceil(diff / DAY_MS));
}
