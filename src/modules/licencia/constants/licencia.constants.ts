import {
  FIRMA_VERSION,
  LICENCIA_PAYLOAD_FIELDS,
  LICENCIA_TIPOS,
  LicenciaTipo,
} from '../services/payload-builder';

export { LICENCIA_TIPOS, LICENCIA_PAYLOAD_FIELDS };
export type { LicenciaTipo };

/**
 * The only accepted `version_firma`. Any other value (0/1/2 legacy HMAC or
 * pipe formats, future versions) is rejected with `version_no_soportada`.
 */
export const FIRMA_VERSION_ACTUAL = FIRMA_VERSION;

/**
 * DEV ONLY Ed25519 public key (raw 32 bytes, base64). Its private key is a
 * development key and MUST NOT be trusted in production. When
 * `NODE_ENV === 'production'` and this is the only trusted key, the crypto
 * service logs an ERROR at startup. See the module README for the production
 * keypair procedure.
 */
export const LICENCIA_DEV_PUBLIC_KEY =
  'JnoxEB42azN5d3cGoEvQPMuYB13cYWXvDBHw3VlKeU0=';

/**
 * Embedded trusted XILEF public keys (raw 32 bytes, base64). A license
 * verifies if ANY key in this list verifies its signature, which allows key
 * rotation by build: add the new key, ship, re-sign, then drop the old key.
 *
 * There is intentionally NO environment override: the trust anchor is part of
 * the build, not of the runtime configuration.
 */
export const LICENCIA_TRUSTED_PUBLIC_KEYS: readonly string[] = [
  LICENCIA_DEV_PUBLIC_KEY,
];

/** DI token for the trusted public keys (tests inject their own keys). */
export const LICENCIA_TRUSTED_KEYS = Symbol('LICENCIA_TRUSTED_KEYS');

/**
 * Allowed clock drift. Used for: clock moving backwards vs the last observed
 * time, and `emitida_en` (vendor clock) ahead of the local clock.
 */
export const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;

/** Fixed namespace mixed into the hardware fingerprint hash. */
export const HARDWARE_FINGERPRINT_NAMESPACE = 'xilef-licencia-hw-v1';

/**
 * Embedded salt for the HKDF that derives the clock-state HMAC key from the
 * hardware fingerprint. It is not a secret against a determined attacker who
 * can read the binary; it only raises the cost of forging the state file.
 */
export const CLOCK_STATE_HKDF_SALT = 'xilef-licencia-clock-state-salt-v1';
export const CLOCK_STATE_HKDF_INFO = 'xilef-licencia-clock-state';

export const LICENCIA_AUDIT_ACCIONES = [
  'activacion',
  'reimportacion',
  'revocacion',
  'rechazo',
  'verificacion',
  'rollback_rechazado',
  'reloj_alterado',
  'hardware_no_coincide',
  'solicitud',
] as const;

export type LicenciaAuditAccion = (typeof LICENCIA_AUDIT_ACCIONES)[number];

/** Version of the unsigned activation request (`.req`) format. */
export const SOLICITUD_VERSION = 1;
