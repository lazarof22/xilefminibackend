import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ActivarLicenciaDto } from './activar-licencia.dto';

/** Same options as the controller / global ValidationPipe. */
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...over,
  };
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version_firma: 3,
    payload: payload(),
    firma: 'a'.repeat(128),
    ...over,
  };
}

/** Flattened `path: constraint` list of every validation error. */
function errores(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => {
    const p = prefix ? `${prefix}.${e.property}` : e.property;
    return [
      ...Object.keys(e.constraints ?? {}).map((c) => `${p}: ${c}`),
      ...errores(e.children ?? [], p),
    ];
  });
}

async function check(plain: Record<string, unknown>): Promise<string[]> {
  return errores(
    await validate(plainToInstance(ActivarLicenciaDto, plain), OPTIONS),
  );
}

describe('ActivarLicenciaDto', () => {
  it('accepts a well-formed v3 artifact', async () => {
    expect(await check(body())).toEqual([]);
  });

  it('accepts a perpetual license with a null fecha_vencimiento', async () => {
    expect(
      await check(
        body({
          payload: payload({ tipo: 'perpetua', fecha_vencimiento: null }),
        }),
      ),
    ).toEqual([]);
  });

  it.each([2, 4, '3', 3.0001])(
    'rejects version_firma %p (only exactly 3)',
    async (version_firma) => {
      expect(await check(body({ version_firma }))).toContain(
        'version_firma: isIn',
      );
    },
  );

  it('rejects unknown top-level and nested keys', async () => {
    const r = await check(
      body({ extra: 1, payload: payload({ nonce: 'abc' }) }),
    );
    expect(r).toEqual(
      expect.arrayContaining([
        'extra: whitelistValidation',
        'payload.nonce: whitelistValidation',
      ]),
    );
  });

  it('rejects a missing fecha_vencimiento (null and missing are distinct)', async () => {
    const p = payload();
    delete p.fecha_vencimiento;
    expect(await check(body({ payload: p }))).toContain(
      'payload.fecha_vencimiento: isString',
    );
  });

  it('rejects a null fecha_vencimiento for a non-perpetual license', async () => {
    expect(
      await check(body({ payload: payload({ fecha_vencimiento: null }) })),
    ).toContain('payload.tipo: vencimientoCoherente');
  });

  it('rejects a perpetual license with an expiry date', async () => {
    expect(
      await check(body({ payload: payload({ tipo: 'perpetua' }) })),
    ).toContain('payload.tipo: vencimientoCoherente');
  });

  it.each([
    ['secuencia', 1.5, 'isInt'],
    ['secuencia', 0, 'min'],
    ['secuencia', '1', 'isInt'],
    ['max_usuarios', 2.5, 'isInt'],
    ['max_usuarios', -1, 'min'],
  ])('rejects %s = %p (%s)', async (field, value, constraint) => {
    expect(
      await check(body({ payload: payload({ [field]: value }) })),
    ).toContain(`payload.${field}: ${constraint}`);
  });

  it('rejects a missing or non-object payload', async () => {
    expect(await check(body({ payload: undefined }))).toContain(
      'payload: isObject',
    );
    expect(await check(body({ payload: 'x' }))).toContain('payload: isObject');
  });
});
