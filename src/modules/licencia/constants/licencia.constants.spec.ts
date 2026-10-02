import * as crypto from 'crypto';
import {
  CLOCK_TOLERANCE_MS,
  FIRMA_VERSION_ACTUAL,
  LICENCIA_DEV_PUBLIC_KEY,
  LICENCIA_TRUSTED_PUBLIC_KEYS,
} from './licencia.constants';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

describe('licencia.constants', () => {
  it('pins the signature version to 3', () => {
    expect(FIRMA_VERSION_ACTUAL).toBe(3);
  });

  it('ships at least one trusted public key', () => {
    expect(LICENCIA_TRUSTED_PUBLIC_KEYS.length).toBeGreaterThan(0);
  });

  it.each(LICENCIA_TRUSTED_PUBLIC_KEYS.map((k) => [k]))(
    'trusted key %s is a valid raw Ed25519 key',
    (key: string) => {
      const raw = Buffer.from(key, 'base64');
      expect(raw.length).toBe(32);
      const pub = crypto.createPublicKey({
        key: Buffer.concat([SPKI_PREFIX, raw]),
        format: 'der',
        type: 'spki',
      });
      expect(pub.asymmetricKeyType).toBe('ed25519');
    },
  );

  it('keeps the dev key clearly identified', () => {
    expect(LICENCIA_TRUSTED_PUBLIC_KEYS).toContain(LICENCIA_DEV_PUBLIC_KEY);
  });

  it('uses a 10 minute clock tolerance', () => {
    expect(CLOCK_TOLERANCE_MS).toBe(10 * 60 * 1000);
  });
});
