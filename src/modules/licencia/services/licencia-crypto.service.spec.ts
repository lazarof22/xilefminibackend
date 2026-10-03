import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { LicenciaCryptoService } from './licencia-crypto.service';
import { buildCanonicalPayload, LicenciaPayloadV3 } from './payload-builder';
import { LICENCIA_DEV_PUBLIC_KEY } from '../constants/licencia.constants';

function rawPublicKey(key: crypto.KeyObject): string {
  const jwk = key.export({ format: 'jwk' });
  return Buffer.from(jwk.x as string, 'base64url').toString('base64');
}

function payload(): LicenciaPayloadV3 {
  return {
    activa: true,
    emitida_en: '2026-01-01T12:00:00.000Z',
    empresa_id: 'EMP-001',
    fecha_inicio: '2026-01-01T00:00:00.000Z',
    fecha_vencimiento: '2027-01-01T00:00:00.000Z',
    hardware_fingerprint: 'a'.repeat(64),
    license_id: '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f',
    max_usuarios: 5,
    revocada: false,
    secuencia: 1,
    tipo: 'suscripcion_anual',
  };
}

function sign(p: LicenciaPayloadV3, key: crypto.KeyObject): string {
  return crypto
    .sign(null, Buffer.from(buildCanonicalPayload(p), 'utf8'), key)
    .toString('hex');
}

describe('LicenciaCryptoService', () => {
  const vendorA = crypto.generateKeyPairSync('ed25519');
  const vendorB = crypto.generateKeyPairSync('ed25519');
  const attacker = crypto.generateKeyPairSync('ed25519');

  let service: LicenciaCryptoService;

  beforeEach(() => {
    service = new LicenciaCryptoService([
      rawPublicKey(vendorA.publicKey),
      rawPublicKey(vendorB.publicKey),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts an artifact signed by any trusted key', () => {
    const p = payload();
    expect(
      service.verifyArtifact({
        version_firma: 3,
        payload: p,
        firma: sign(p, vendorA.privateKey),
      }),
    ).toEqual({ ok: true, payload: p, firma: sign(p, vendorA.privateKey) });
    expect(
      service.verifyArtifact({
        version_firma: 3,
        payload: p,
        firma: sign(p, vendorB.privateKey),
      }).ok,
    ).toBe(true);
  });

  it('rejects an artifact signed by an untrusted key', () => {
    const p = payload();
    expect(
      service.verifyArtifact({
        version_firma: 3,
        payload: p,
        firma: sign(p, attacker.privateKey),
      }),
    ).toEqual({ ok: false, codigo: 'firma_invalida' });
  });

  it('rejects a tampered payload', () => {
    const p = payload();
    const firma = sign(p, vendorA.privateKey);
    expect(
      service.verifyArtifact({
        version_firma: 3,
        payload: { ...p, max_usuarios: 500 },
        firma,
      }),
    ).toEqual({ ok: false, codigo: 'firma_invalida' });
  });

  it.each([0, 1, 2, 4, '3', undefined, null])(
    'rejects version_firma %p without throwing',
    (version) => {
      const p = payload();
      expect(
        service.verifyArtifact({
          version_firma: version,
          payload: p,
          firma: sign(p, vendorA.privateKey),
        }),
      ).toEqual({ ok: false, codigo: 'version_no_soportada' });
    },
  );

  it.each([
    ['null artifact', null],
    ['missing firma', { version_firma: 3, payload: payload() }],
    [
      'uppercase firma',
      { version_firma: 3, payload: payload(), firma: 'A'.repeat(128) },
    ],
    [
      'invalid payload',
      { version_firma: 3, payload: { a: 1 }, firma: 'a'.repeat(128) },
    ],
  ])('rejects %s as formato_invalido', (_name, artifact) => {
    expect(service.verifyArtifact(artifact)).toEqual({
      ok: false,
      codigo: 'formato_invalido',
    });
  });

  it('does not read the public key from the environment', () => {
    const p = payload();
    process.env.LICENCIA_ED25519_PUBLIC_KEY = rawPublicKey(attacker.publicKey);
    try {
      const fresh = new LicenciaCryptoService([
        rawPublicKey(vendorA.publicKey),
      ]);
      expect(
        fresh.verifyArtifact({
          version_firma: 3,
          payload: p,
          firma: sign(p, attacker.privateKey),
        }).ok,
      ).toBe(false);
    } finally {
      delete process.env.LICENCIA_ED25519_PUBLIC_KEY;
    }
  });

  it('refuses to start with a malformed trusted key', () => {
    expect(() => new LicenciaCryptoService(['bm90LWEta2V5'])).toThrow();
  });

  it('refuses to start with no trusted keys', () => {
    expect(() => new LicenciaCryptoService([])).toThrow();
  });

  it.each([
    ['trailing newline', `${LICENCIA_DEV_PUBLIC_KEY}\n`],
    ['inner junk', `*${LICENCIA_DEV_PUBLIC_KEY}`],
    ['base64url alphabet', LICENCIA_DEV_PUBLIC_KEY.replace(/=$/, '')],
  ])('refuses a non-canonical base64 trusted key (%s)', (_name, key) => {
    expect(() => new LicenciaCryptoService([key])).toThrow(
      'Trusted license public key must be canonical base64',
    );
  });

  describe('onModuleInit dev key check', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('refuses to start in production when only the dev key is trusted', () => {
      process.env.NODE_ENV = 'production';
      expect(() =>
        new LicenciaCryptoService([LICENCIA_DEV_PUBLIC_KEY]).onModuleInit(),
      ).toThrow('DEV key is trusted');
    });

    it('refuses to start in production when the dev key is trusted next to a real key', () => {
      process.env.NODE_ENV = 'production';
      expect(() =>
        new LicenciaCryptoService([
          rawPublicKey(vendorA.publicKey),
          LICENCIA_DEV_PUBLIC_KEY,
        ]).onModuleInit(),
      ).toThrow('DEV key is trusted');
    });

    it('starts in production when only real keys are trusted', () => {
      process.env.NODE_ENV = 'production';
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('only warns outside production', () => {
      const spy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      process.env.NODE_ENV = 'development';
      expect(() =>
        new LicenciaCryptoService([LICENCIA_DEV_PUBLIC_KEY]).onModuleInit(),
      ).not.toThrow();
      expect(spy).toHaveBeenCalled();
    });
  });
});
