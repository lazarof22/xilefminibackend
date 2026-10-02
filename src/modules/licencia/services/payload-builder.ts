/**
 * Canonical license payload v3 — pure, no DI, no env.
 *
 * Shared by the client backend (verify-only) and the XILEF signer CLI. Both
 * copies MUST stay byte-for-byte identical except for comments, so both sides
 * produce the exact same bytes for the same logical license. The golden
 * fixture `payload-v3.golden.json` is tested in both repositories.
 *
 * Perpetual licenses: `tipo === 'perpetua'` if and only if
 * `fecha_vencimiento === null`. Any other combination is rejected.
 */

export const FIRMA_VERSION = 3;

export const LICENCIA_TIPOS = [
  'trial',
  'suscripcion_mensual',
  'suscripcion_anual',
  'perpetua',
] as const;

export type LicenciaTipo = (typeof LICENCIA_TIPOS)[number];

export const LICENCIA_PAYLOAD_FIELDS = [
  'activa',
  'emitida_en',
  'empresa_id',
  'fecha_inicio',
  'fecha_vencimiento',
  'hardware_fingerprint',
  'license_id',
  'max_usuarios',
  'revocada',
  'secuencia',
  'tipo',
] as const;

export interface LicenciaPayloadV3 {
  activa: boolean;
  emitida_en: string;
  empresa_id: string;
  fecha_inicio: string;
  fecha_vencimiento: string | null;
  hardware_fingerprint: string;
  license_id: string;
  max_usuarios: number;
  revocada: boolean;
  secuencia: number;
  tipo: LicenciaTipo;
}

export interface LicenciaArtifactV3 {
  version_firma: number;
  payload: LicenciaPayloadV3;
  firma: string;
}

export type PayloadValidation =
  { ok: true; payload: LicenciaPayloadV3 } | { ok: false; error: string };

export const EMPRESA_ID_MAX_LENGTH = 64;
export const HARDWARE_FINGERPRINT_REGEX = /^[0-9a-f]{64}$/;
export const LICENSE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const FIRMA_REGEX = /^[0-9a-f]{128}$/;

export function canonicalStringify(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = payload[k];
  return JSON.stringify(sorted);
}

export function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export function buildCanonicalPayload(p: LicenciaPayloadV3): string {
  return canonicalStringify({
    activa: p.activa,
    emitida_en: p.emitida_en,
    empresa_id: p.empresa_id,
    fecha_inicio: p.fecha_inicio,
    fecha_vencimiento: p.fecha_vencimiento,
    hardware_fingerprint: p.hardware_fingerprint,
    license_id: p.license_id,
    max_usuarios: p.max_usuarios,
    revocada: p.revocada,
    secuencia: p.secuencia,
    tipo: p.tipo,
  });
}

function fail(error: string): PayloadValidation {
  return { ok: false, error };
}

export function validateLicenciaPayload(value: unknown): PayloadValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('payload must be an object');
  }
  const p = value as Record<string, unknown>;
  const keys = Object.keys(p).sort();
  const expected: readonly string[] = LICENCIA_PAYLOAD_FIELDS;
  if (
    keys.length !== expected.length ||
    keys.some((k, i) => k !== expected[i])
  ) {
    return fail('payload must contain exactly the signed fields');
  }
  if (typeof p.activa !== 'boolean') return fail('activa must be boolean');
  if (typeof p.revocada !== 'boolean') return fail('revocada must be boolean');
  if (!isCanonicalIso(p.emitida_en)) return fail('emitida_en must be ISO');
  if (!isCanonicalIso(p.fecha_inicio)) return fail('fecha_inicio must be ISO');
  if (
    typeof p.empresa_id !== 'string' ||
    p.empresa_id.trim().length === 0 ||
    p.empresa_id.length > EMPRESA_ID_MAX_LENGTH
  ) {
    return fail('empresa_id must be a non-empty string up to 64 chars');
  }
  if (
    typeof p.hardware_fingerprint !== 'string' ||
    !HARDWARE_FINGERPRINT_REGEX.test(p.hardware_fingerprint)
  ) {
    return fail('hardware_fingerprint must be 64 lowercase hex chars');
  }
  if (
    typeof p.license_id !== 'string' ||
    !LICENSE_ID_REGEX.test(p.license_id)
  ) {
    return fail('license_id must be a lowercase uuid');
  }
  if (
    typeof p.max_usuarios !== 'number' ||
    !Number.isSafeInteger(p.max_usuarios) ||
    p.max_usuarios < 0
  ) {
    return fail('max_usuarios must be an integer >= 0');
  }
  if (
    typeof p.secuencia !== 'number' ||
    !Number.isSafeInteger(p.secuencia) ||
    p.secuencia < 1
  ) {
    return fail('secuencia must be an integer >= 1');
  }
  const tipos: readonly string[] = LICENCIA_TIPOS;
  if (typeof p.tipo !== 'string' || !tipos.includes(p.tipo)) {
    return fail('tipo is not supported');
  }
  if (p.tipo === 'perpetua') {
    if (p.fecha_vencimiento !== null) {
      return fail('perpetua requires fecha_vencimiento null');
    }
  } else {
    if (!isCanonicalIso(p.fecha_vencimiento)) {
      return fail('fecha_vencimiento must be ISO for non perpetual licenses');
    }
    if (Date.parse(p.fecha_vencimiento) <= Date.parse(p.fecha_inicio)) {
      return fail('fecha_vencimiento must be after fecha_inicio');
    }
  }
  return { ok: true, payload: p as unknown as LicenciaPayloadV3 };
}
