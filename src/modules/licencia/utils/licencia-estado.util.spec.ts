import { derivarCodigo, diasRestantes } from './licencia-estado.util';
import { LicenciaPayloadV3 } from '../services/payload-builder';
import { CLOCK_TOLERANCE_MS } from '../constants/licencia.constants';

const FP = 'a'.repeat(64);
const DAY = 24 * 60 * 60 * 1000;

function payload(over: Partial<LicenciaPayloadV3> = {}): LicenciaPayloadV3 {
  return {
    activa: true,
    emitida_en: '2026-01-01T12:00:00.000Z',
    empresa_id: 'EMP-001',
    fecha_inicio: '2026-01-01T00:00:00.000Z',
    fecha_vencimiento: '2027-01-01T00:00:00.000Z',
    hardware_fingerprint: FP,
    license_id: '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f',
    max_usuarios: 5,
    revocada: false,
    secuencia: 1,
    tipo: 'suscripcion_anual',
    ...over,
  };
}

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

describe('derivarCodigo', () => {
  const ctx = { ahoraMs: NOW, fingerprint: FP };

  it('returns valida for a current, active, bound license', () => {
    expect(derivarCodigo(payload(), ctx)).toBe('valida');
  });

  it('checks the hardware binding', () => {
    expect(
      derivarCodigo(payload(), { ...ctx, fingerprint: 'b'.repeat(64) }),
    ).toBe('hardware_no_coincide');
  });

  it('checks the empresa when one is requested', () => {
    expect(derivarCodigo(payload(), { ...ctx, empresaId: 'OTHER' })).toBe(
      'empresa_no_coincide',
    );
    expect(derivarCodigo(payload(), { ...ctx, empresaId: 'EMP-001' })).toBe(
      'valida',
    );
  });

  it('rejects a clock earlier than emitida_en beyond tolerance', () => {
    const p = payload({
      emitida_en: new Date(NOW + CLOCK_TOLERANCE_MS + 1).toISOString(),
    });
    expect(derivarCodigo(p, ctx)).toBe('reloj_alterado');
    const ok = payload({
      emitida_en: new Date(NOW + CLOCK_TOLERANCE_MS - 1).toISOString(),
    });
    expect(derivarCodigo(ok, ctx)).toBe('valida');
  });

  it('revocation wins over everything else after binding checks', () => {
    expect(derivarCodigo(payload({ revocada: true, activa: false }), ctx)).toBe(
      'revocada',
    );
    expect(
      derivarCodigo(
        payload({
          revocada: true,
          fecha_vencimiento: '2026-02-01T00:00:00.000Z',
        }),
        ctx,
      ),
    ).toBe('revocada');
  });

  it('reports inactiva when activa is false', () => {
    expect(derivarCodigo(payload({ activa: false }), ctx)).toBe('inactiva');
  });

  it('reports no_iniciada before fecha_inicio', () => {
    expect(
      derivarCodigo(
        payload({
          fecha_inicio: '2026-07-01T00:00:00.000Z',
          emitida_en: '2026-05-01T00:00:00.000Z',
        }),
        ctx,
      ),
    ).toBe('no_iniciada');
  });

  it('reports expirada after fecha_vencimiento, with no grace period', () => {
    expect(
      derivarCodigo(
        payload({ fecha_vencimiento: '2026-05-31T23:59:59.999Z' }),
        ctx,
      ),
    ).toBe('expirada');
  });

  it('never expires a perpetual license', () => {
    expect(
      derivarCodigo(payload({ tipo: 'perpetua', fecha_vencimiento: null }), {
        ...ctx,
        ahoraMs: Date.parse('2099-01-01T00:00:00.000Z'),
      }),
    ).toBe('valida');
  });
});

describe('derivarCodigo — fail closed on bad input', () => {
  const ctx = { ahoraMs: NOW, fingerprint: FP };

  it.each([NaN, Infinity, -Infinity])(
    'never reports valida for a non-finite clock (%p)',
    (ahoraMs) => {
      expect(derivarCodigo(payload(), { ...ctx, ahoraMs })).toBe(
        'error_interno',
      );
    },
  );

  it.each([
    ['emitida_en', { emitida_en: 'not-a-date' }],
    ['fecha_inicio', { fecha_inicio: 'not-a-date' }],
    ['fecha_vencimiento', { fecha_vencimiento: '2027-13-45' }],
  ] as const)('rejects an unparseable %s', (_field, over) => {
    expect(derivarCodigo(payload(over), ctx)).toBe('formato_invalido');
  });
});

describe('diasRestantes', () => {
  it('is never NaN for unparseable dates or a non-finite clock', () => {
    expect(diasRestantes(payload({ fecha_vencimiento: 'nope' }), NOW)).toBe(0);
    expect(diasRestantes(payload(), NaN)).toBe(0);
    expect(diasRestantes(payload(), Infinity)).toBe(0);
  });

  it('is null for perpetual licenses', () => {
    expect(
      diasRestantes(
        payload({ tipo: 'perpetua', fecha_vencimiento: null }),
        NOW,
      ),
    ).toBeNull();
  });

  it('rounds up remaining days and never goes negative', () => {
    expect(
      diasRestantes(
        payload({ fecha_vencimiento: new Date(NOW + 1.5 * DAY).toISOString() }),
        NOW,
      ),
    ).toBe(2);
    expect(
      diasRestantes(
        payload({ fecha_vencimiento: new Date(NOW - 5 * DAY).toISOString() }),
        NOW,
      ),
    ).toBe(0);
  });
});
