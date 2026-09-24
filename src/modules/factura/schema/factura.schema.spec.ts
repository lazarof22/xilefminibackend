import { EstadoFactura, TipoPago } from '../factura.constants';
import { FacturaSchema } from './factura.schema';

/**
 * Pins the invariant that guarantees an annulled invoice's code is never
 * reused (T6a, "Decisions" in odd/tasks/factura-spec-alignment.md): both
 * `id` and `numero` are unique-indexed, and the counter (see
 * `FacturaService.siguienteNumero`) is never decremented on `anular`, so
 * no later invoice can ever collide with an already-used code.
 */
describe('FacturaSchema (T6a)', () => {
  it('has a unique index on numero', () => {
    expect(FacturaSchema.path('numero').options.unique).toBe(true);
  });

  it('has a unique index on id', () => {
    expect(FacturaSchema.path('id').options.unique).toBe(true);
  });

  it('defaults estado to edicion', () => {
    expect(FacturaSchema.path('estado').options.default).toBe(
      EstadoFactura.EDICION,
    );
  });

  it('only accepts the EstadoFactura enum values on estado', () => {
    expect(FacturaSchema.path('estado').options.enum).toEqual(
      Object.values(EstadoFactura),
    );
  });
});

/**
 * T6b: `talonario` (a free-text receipt-book reference) and `estadoLegado`
 * (preserves the pre-migration `'ajustada'` value lost when
 * `FacturaService.migrarEstadoAjustada` normalizes it to `confirmada`) are
 * both optional so legacy invoices without them still load.
 */
describe('FacturaSchema (T6b)', () => {
  it('has an optional talonario path', () => {
    const path = FacturaSchema.path('talonario');
    expect(path).toBeDefined();
    expect(path.isRequired).toBeFalsy();
  });

  it('has an optional estadoLegado path restricted to "ajustada"', () => {
    const path = FacturaSchema.path('estadoLegado');
    expect(path).toBeDefined();
    expect(path.isRequired).toBeFalsy();
    expect(path.options.enum).toEqual(['ajustada']);
  });

  it('types metodoPago against the TipoPago enum values', () => {
    expect(FacturaSchema.path('metodoPago').options.enum).toEqual(
      Object.values(TipoPago),
    );
  });
});
