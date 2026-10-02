import * as fs from 'fs';
import * as path from 'path';
import {
  buildCanonicalPayload,
  FIRMA_VERSION,
  LICENCIA_PAYLOAD_FIELDS,
  LicenciaPayloadV3,
  validateLicenciaPayload,
} from './payload-builder';

interface GoldenCase {
  name: string;
  payload: LicenciaPayloadV3;
  canonical: string;
}

const golden = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '__fixtures__', 'payload-v3.golden.json'),
    'utf8',
  ),
) as { cases: GoldenCase[] };

function basePayload(): LicenciaPayloadV3 {
  return { ...golden.cases[0].payload };
}

describe('payload-builder v3', () => {
  it('pins the signature version to 3', () => {
    expect(FIRMA_VERSION).toBe(3);
  });

  it('declares the 11 signed fields in sorted order', () => {
    expect(LICENCIA_PAYLOAD_FIELDS).toEqual([
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
    ]);
  });

  describe.each(golden.cases)('golden case $name', (c) => {
    it('produces the exact canonical bytes', () => {
      expect(buildCanonicalPayload(c.payload)).toBe(c.canonical);
    });

    it('passes strict validation', () => {
      const result = validateLicenciaPayload(c.payload);
      expect(result.ok).toBe(true);
    });
  });

  it('ignores properties outside the signed field set when building', () => {
    const withExtra = {
      ...basePayload(),
      extra: 'x',
    } as LicenciaPayloadV3;
    expect(buildCanonicalPayload(withExtra)).toBe(golden.cases[0].canonical);
  });

  describe('validateLicenciaPayload', () => {
    const invalid: Array<[string, (p: Record<string, unknown>) => void]> = [
      ['extra key', (p) => (p.extra = 1)],
      ['missing key', (p) => delete p.secuencia],
      ['non canonical emitida_en', (p) => (p.emitida_en = '2026-01-01')],
      ['empty empresa_id', (p) => (p.empresa_id = '')],
      ['too long empresa_id', (p) => (p.empresa_id = 'x'.repeat(65))],
      [
        'uppercase fingerprint',
        (p) => (p.hardware_fingerprint = 'A'.repeat(64)),
      ],
      ['short fingerprint', (p) => (p.hardware_fingerprint = 'a'.repeat(63))],
      ['bad license_id', (p) => (p.license_id = 'XILEF-AAAA-BBBB-CCCC-DDDD')],
      ['negative max_usuarios', (p) => (p.max_usuarios = -1)],
      ['float max_usuarios', (p) => (p.max_usuarios = 1.5)],
      ['secuencia zero', (p) => (p.secuencia = 0)],
      ['string secuencia', (p) => (p.secuencia = '1')],
      ['unknown tipo', (p) => (p.tipo = 'gold')],
      ['activa not boolean', (p) => (p.activa = 'true')],
      ['revocada not boolean', (p) => (p.revocada = 1)],
      ['perpetua with expiry', (p) => (p.tipo = 'perpetua')],
      ['non perpetua without expiry', (p) => (p.fecha_vencimiento = null)],
      [
        'expiry before start',
        (p) => (p.fecha_vencimiento = '2025-01-01T00:00:00.000Z'),
      ],
    ];

    it.each(invalid)('rejects %s', (_name, mutate) => {
      const p = basePayload() as unknown as Record<string, unknown>;
      mutate(p);
      const result = validateLicenciaPayload(p);
      expect(result.ok).toBe(false);
    });

    it.each([null, undefined, 'string', 42, []])('rejects %p', (value) => {
      expect(validateLicenciaPayload(value).ok).toBe(false);
    });
  });
});
