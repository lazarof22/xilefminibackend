import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFacturaDto } from './update-factura.dto';

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

/**
 * `UpdateFacturaDto` only validates shape: whether a given field is
 * actually settable in the invoice's *current* state is a service-level
 * concern (`FacturaService.update`, `factura-estado.ts` —
 * `camposEditablesPorEstado`/`camposNoPermitidos`), covered in
 * `factura.service.spec.ts` and `factura-estado.spec.ts`.
 */
describe('UpdateFacturaDto (T6b)', () => {
  it('accepts every business field CreateFacturaDto accepts, except tipo', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      fecha: '2026-09-24',
      cliente: 'Ana Perez',
      nit: '12345678901',
      direccion: 'Calle 1',
      telefono: '5555',
      email: 'a@b.com',
      moneda: 'CUP',
      concepto: 'Nuevo concepto',
      almacenId: ALMACEN_ID_VALIDO,
      impuesto: { tipo: 'IVA', porciento: 10 },
      metodoPago: 'efectivo',
      items: [itemValido()],
      impreso: true,
      despachadoPor: {
        nombre: 'Juan Perez',
        ci: '12345678901',
        fecha: '2026-09-22',
      },
      transportadoPor: {
        nombre: 'Ana Lopez',
        ci: '12345678902',
        fecha: '2026-09-22',
      },
      recibidoPor: {
        nombre: 'Luis Diaz',
        ci: '12345678903',
        fecha: '2026-09-22',
      },
      talonario: 'T-001',
    });
    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errores).toHaveLength(0);
  });

  it('rejects an invalid nested participant (empty nombre)', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      despachadoPor: { nombre: '  ', ci: '12345678901', fecha: '2026-09-22' },
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
  });

  it('rejects an explicit null for a participant instead of silently accepting it as absent', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      despachadoPor: null,
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
  });

  it('rejects an explicit null for talonario instead of silently accepting it as absent', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, { talonario: null });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'talonario')).toBe(true);
  });

  it('rejects an empty talonario when sent', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, { talonario: '   ' });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'talonario')).toBe(true);
  });

  it('trims surrounding whitespace from talonario', () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      talonario: '  T-001  ',
    });
    expect(instancia.talonario).toBe('T-001');
  });

  it('rejects an empty items array when items is sent', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, { items: [] });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'items')).toBe(true);
  });

  it('rejects a metodoPago outside the TipoPago enum when sent', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      metodoPago: 'cheque',
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'metodoPago')).toBe(true);
  });

  it('rejects a malformed fecha when sent', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      fecha: '22-09-2026',
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'fecha')).toBe(true);
  });

  it('rejects an almacenId that is not a valid Mongo ObjectId when sent', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      almacenId: 'no-es-un-object-id',
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'almacenId')).toBe(true);
  });

  it('rejects server-controlled fields: numero, estado, totals, emisor, facturadoPor, almacenCodigo, clienteId', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      concepto: 'x',
      numero: 5,
      estado: 'anulada',
      total: 999,
      subtotal: 999,
      descuentoTotal: 999,
      recargoTotal: 999,
      emisor: { nombre: 'Falso' },
      facturadoPor: { nombre: 'Falso', ci: '1', empleadoId: '1' },
      almacenCodigo: 'ALM-001',
      clienteId: '507f1f77bcf86cd799439011',
    });
    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const propiedadesRechazadas = errores.map((e) => e.property);
    for (const campo of [
      'numero',
      'estado',
      'total',
      'subtotal',
      'descuentoTotal',
      'recargoTotal',
      'emisor',
      'facturadoPor',
      'almacenCodigo',
      'clienteId',
    ]) {
      expect(propiedadesRechazadas).toContain(campo);
    }
  });

  it('rejects tipo (not part of the editable field set, unlike CreateFacturaDto)', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      tipo: 'ajuste',
    });
    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errores.some((e) => e.property === 'tipo')).toBe(true);
  });

  it('has every field optional', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {});
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });
});
