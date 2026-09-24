import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFacturaDto, ParticipanteFacturaDto } from './create-factura.dto';

const PRODUCTO_ID_VALIDO = '507f1f77bcf86cd799439011';
const ALMACEN_ID_VALIDO = '507f1f77bcf86cd799439012';

function itemValido(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'item-1',
    productoId: PRODUCTO_ID_VALIDO,
    productoNombre: 'Producto 1',
    cantidad: 2,
    precio: 100,
    costo: 40,
    descuentoPct: 0,
    descuentoMonto: 0,
    recargo: 0,
    ...overrides,
  };
}

function dtoValido(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    metodoPago: 'efectivo',
    almacenId: ALMACEN_ID_VALIDO,
    items: [itemValido()],
    ...overrides,
  };
}

describe('CreateFacturaDto (T2)', () => {
  it('is rejected by the global forbidNonWhitelisted pipe when server-controlled fields are sent (id, numero, estado, total, subtotal, descuentoTotal, recargoTotal)', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido(),
      id: 'FAC-000001',
      numero: 1,
      estado: 'confirmada',
      total: 100,
      subtotal: 100,
      descuentoTotal: 0,
      recargoTotal: 0,
    });

    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    const propiedadesRechazadas = errores.map((e) => e.property);
    for (const campo of [
      'id',
      'numero',
      'estado',
      'total',
      'subtotal',
      'descuentoTotal',
      'recargoTotal',
    ]) {
      expect(propiedadesRechazadas).toContain(campo);
    }
  });

  it('rejects an empty items array', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido({ items: [] }),
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'items')).toBe(true);
  });

  it('rejects a non-positive cantidad', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido({ items: [itemValido({ cantidad: 0 })] }),
    });
    const errores = await validate(instancia, { whitelist: true });
    const itemErrors = errores.find((e) => e.property === 'items');
    expect(itemErrors).toBeDefined();
  });

  it('rejects a negative precio/costo/descuentoMonto/recargo', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido({ items: [itemValido({ precio: -1 })] }),
    });
    const errores = await validate(instancia);
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rejects a descuentoPct outside 0-100', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido({ items: [itemValido({ descuentoPct: 150 })] }),
    });
    const errores = await validate(instancia);
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rejects an impuesto.porciento outside 0-100', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido({ impuesto: { tipo: 'ISV', porciento: 101 } }),
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'impuesto')).toBe(true);
  });

  it('rejects a negative impuesto.importe', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido({ impuesto: { tipo: 'ISV', importe: -5 } }),
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'impuesto')).toBe(true);
  });

  it('accepts a fully valid payload with no server-controlled fields', async () => {
    const instancia = plainToInstance(CreateFacturaDto, dtoValido());
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('rejects emisor: the issuer always comes from EmpresaDatos server-side (T8)', async () => {
    const instancia = plainToInstance(CreateFacturaDto, {
      ...dtoValido(),
      emisor: { nombre: 'Otra empresa', nit: '999' },
    });

    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errores.some((e) => e.property === 'emisor')).toBe(true);
  });

  describe('almacen y producto (T2)', () => {
    it('requires almacenId', async () => {
      const instancia = plainToInstance(CreateFacturaDto, {
        ...dtoValido({ almacenId: undefined }),
      });
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'almacenId')).toBe(true);
    });

    it('rejects an almacenId that is not a valid Mongo ObjectId', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ almacenId: 'no-es-un-object-id' }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'almacenId')).toBe(true);
    });

    it('accepts a valid almacenId', async () => {
      const instancia = plainToInstance(CreateFacturaDto, dtoValido());
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'almacenId')).toBe(false);
    });

    it('rejects a productoId that is not a valid Mongo ObjectId', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ items: [itemValido({ productoId: 'no-es-un-id' })] }),
      );
      const errores = await validate(instancia);
      const itemErrors = errores.find((e) => e.property === 'items');
      expect(itemErrors).toBeDefined();
    });
  });

  describe('fecha (T4)', () => {
    it('accepts a well-formed YYYY-MM-DD date', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ fecha: '2026-09-22' }),
      );
      const errores = await validate(instancia);
      expect(errores).toHaveLength(0);
    });

    it('is optional (server computes a default when absent)', async () => {
      const instancia = plainToInstance(CreateFacturaDto, dtoValido());
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'fecha')).toBe(false);
    });

    it('rejects a malformed date string', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ fecha: '22-09-2026' }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'fecha')).toBe(true);
    });

    it('rejects a syntactically valid but non-existent calendar date', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ fecha: '2026-02-30' }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'fecha')).toBe(true);
    });
  });

  describe('metodoPago (T3)', () => {
    it('accepts efectivo, transferencia and credito', async () => {
      for (const metodoPago of ['efectivo', 'transferencia', 'credito']) {
        const instancia = plainToInstance(
          CreateFacturaDto,
          dtoValido({ metodoPago }),
        );
        const errores = await validate(instancia);
        expect(errores.some((e) => e.property === 'metodoPago')).toBe(false);
      }
    });

    it('rejects a metodoPago outside the TipoPago enum', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ metodoPago: 'cheque' }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'metodoPago')).toBe(true);
    });

    it('rejects a missing metodoPago', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ metodoPago: undefined }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'metodoPago')).toBe(true);
    });
  });

  describe('participantes: despachadoPor / transportadoPor / recibidoPor (T3)', () => {
    function participanteValido(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        nombre: 'Juan Perez',
        ci: '12345678901',
        fecha: '2026-09-22',
        ...overrides,
      };
    }

    it('are optional', async () => {
      const instancia = plainToInstance(CreateFacturaDto, dtoValido());
      const errores = await validate(instancia);
      expect(
        errores.some((e) =>
          ['despachadoPor', 'transportadoPor', 'recibidoPor'].includes(
            e.property,
          ),
        ),
      ).toBe(false);
    });

    it('accepts a fully valid despachadoPor/transportadoPor/recibidoPor', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: participanteValido(),
          transportadoPor: participanteValido({ nombre: 'Ana Lopez' }),
          recibidoPor: participanteValido({ nombre: 'Luis Diaz' }),
        }),
      );
      const errores = await validate(instancia);
      expect(errores).toHaveLength(0);
    });

    it('trims nombre and ci', () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: participanteValido({
            nombre: '  Juan Perez  ',
            ci: '  12345678901  ',
          }),
        }),
      );
      expect(instancia.despachadoPor?.nombre).toBe('Juan Perez');
      expect(instancia.despachadoPor?.ci).toBe('12345678901');
    });

    it('rejects an empty nombre', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: participanteValido({ nombre: '   ' }),
        }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
    });

    it('rejects a nombre longer than 200 characters', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: participanteValido({ nombre: 'a'.repeat(201) }),
        }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
    });

    it('rejects an empty ci', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          transportadoPor: participanteValido({ ci: '' }),
        }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'transportadoPor')).toBe(true);
    });

    it('rejects a ci longer than 20 characters (still accepts non-digit foreign ids up to that length)', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          recibidoPor: participanteValido({ ci: 'X'.repeat(21) }),
        }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'recibidoPor')).toBe(true);
    });

    it('accepts a non-numeric ci (foreign document) up to 20 characters', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          recibidoPor: participanteValido({ ci: 'PASSPORT-AB1234' }),
        }),
      );
      const errores = await validate(instancia);
      expect(errores).toHaveLength(0);
    });

    it('rejects a malformed fecha', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: participanteValido({ fecha: '22-09-2026' }),
        }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
    });

    it('rejects a missing fecha', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: { nombre: 'Juan Perez', ci: '12345678901' },
        }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
    });

    it('rejects a missing nombre', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: { ci: '12345678901', fecha: '2026-09-22' },
        }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
    });

    it('ParticipanteFacturaDto standalone also rejects an incomplete payload', async () => {
      const instancia = plainToInstance(ParticipanteFacturaDto, {
        nombre: 'Juan Perez',
      });
      const errores = await validate(instancia);
      expect(errores.length).toBeGreaterThan(0);
    });

    it('rejects an explicit null instead of silently accepting it as absent (T6b)', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({
          despachadoPor: null,
          transportadoPor: null,
          recibidoPor: null,
        }),
      );
      const errores = await validate(instancia);
      const propiedadesRechazadas = errores.map((e) => e.property);
      expect(propiedadesRechazadas).toEqual(
        expect.arrayContaining([
          'despachadoPor',
          'transportadoPor',
          'recibidoPor',
        ]),
      );
    });
  });

  describe('talonario (T6b)', () => {
    it('is optional', async () => {
      const instancia = plainToInstance(CreateFacturaDto, dtoValido());
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'talonario')).toBe(false);
    });

    it('trims surrounding whitespace', () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ talonario: '  T-001  ' }),
      );
      expect(instancia.talonario).toBe('T-001');
    });

    it('rejects an empty talonario when sent', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ talonario: '   ' }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'talonario')).toBe(true);
    });

    it('rejects a talonario longer than 50 characters', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ talonario: 'T'.repeat(51) }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'talonario')).toBe(true);
    });

    it('rejects an explicit null instead of silently accepting it as absent', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ talonario: null }),
      );
      const errores = await validate(instancia);
      expect(errores.some((e) => e.property === 'talonario')).toBe(true);
    });

    it('accepts a valid talonario', async () => {
      const instancia = plainToInstance(
        CreateFacturaDto,
        dtoValido({ talonario: 'T-001' }),
      );
      const errores = await validate(instancia);
      expect(errores).toHaveLength(0);
    });
  });
});
