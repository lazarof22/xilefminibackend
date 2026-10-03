import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  buildCanonicalPayload,
  FIRMA_REGEX,
  LicenciaPayloadV3,
  validateLicenciaPayload,
} from './payload-builder';
import {
  FIRMA_VERSION_ACTUAL,
  LICENCIA_DEV_PUBLIC_KEY,
  LICENCIA_TRUSTED_KEYS,
} from '../constants/licencia.constants';

/**
 * Fixed X.509 SPKI prefix of an Ed25519 public key (RFC 8410). Prepended to the
 * 32 raw bytes it rebuilds the DER loadable with `crypto.createPublicKey`.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type ArtifactRejectCode =
  'version_no_soportada' | 'formato_invalido' | 'firma_invalida';

export type ArtifactVerification =
  | { ok: true; payload: LicenciaPayloadV3; firma: string }
  | { ok: false; codigo: ArtifactRejectCode };

/**
 * Client crypto service — VERIFY ONLY. The Ed25519 private key lives only on
 * the XILEF signing machine. Trusted public keys are embedded in the build
 * (`LICENCIA_TRUSTED_PUBLIC_KEYS`) and injected through DI; there is no env
 * override.
 */
@Injectable()
export class LicenciaCryptoService implements OnModuleInit {
  private readonly logger = new Logger(LicenciaCryptoService.name);
  private readonly trustedRawKeys: readonly string[];
  private readonly trustedKeys: readonly crypto.KeyObject[];

  constructor(
    @Inject(LICENCIA_TRUSTED_KEYS) trustedRawKeys: readonly string[],
  ) {
    if (trustedRawKeys.length === 0) {
      throw new Error('No trusted license public keys configured');
    }
    this.trustedRawKeys = trustedRawKeys;
    this.trustedKeys = trustedRawKeys.map((rawB64) => {
      const raw = Buffer.from(rawB64, 'base64');
      // Node's base64 decoder silently skips invalid characters; require a
      // byte-exact round trip so a mangled key cannot slip through.
      if (raw.toString('base64') !== rawB64) {
        throw new Error('Trusted license public key must be canonical base64');
      }
      if (raw.length !== 32) {
        throw new Error('Trusted license public key must be 32 raw bytes');
      }
      return crypto.createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
        format: 'der',
        type: 'spki',
      });
    });
  }

  /**
   * Fails closed in production whenever the DEV key is in the trusted list,
   * alone or next to real keys (anyone holding the dev private key could mint
   * licenses). Outside production it only warns.
   */
  onModuleInit(): void {
    if (!this.trustedRawKeys.includes(LICENCIA_DEV_PUBLIC_KEY)) return;
    const message =
      'SECURITY: the DEV key is trusted as a license public key. ' +
      'Generate the production keypair with the signer, embed its public ' +
      'key in LICENCIA_TRUSTED_PUBLIC_KEYS and remove the DEV key for ' +
      'production builds.';
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(message);
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  generateSHA256Hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Verifies a signed artifact `{ version_firma, payload, firma }`. Never
   * throws: every failure is a typed rejection.
   */
  verifyArtifact(artifact: unknown): ArtifactVerification {
    if (typeof artifact !== 'object' || artifact === null) {
      return { ok: false, codigo: 'formato_invalido' };
    }
    const a = artifact as Record<string, unknown>;
    if (a.version_firma !== FIRMA_VERSION_ACTUAL) {
      return { ok: false, codigo: 'version_no_soportada' };
    }
    if (typeof a.firma !== 'string' || !FIRMA_REGEX.test(a.firma)) {
      return { ok: false, codigo: 'formato_invalido' };
    }
    const validation = validateLicenciaPayload(a.payload);
    if (!validation.ok) {
      return { ok: false, codigo: 'formato_invalido' };
    }
    const data = Buffer.from(buildCanonicalPayload(validation.payload), 'utf8');
    const signature = Buffer.from(a.firma, 'hex');
    const verified = this.trustedKeys.some((key) => {
      try {
        return crypto.verify(null, data, key, signature);
      } catch {
        return false;
      }
    });
    if (!verified) {
      return { ok: false, codigo: 'firma_invalida' };
    }
    return { ok: true, payload: validation.payload, firma: a.firma };
  }
}
