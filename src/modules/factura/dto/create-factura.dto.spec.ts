import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFacturaDto } from './create-factura.dto';

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
});
