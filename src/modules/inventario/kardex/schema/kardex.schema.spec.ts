import { model, Types } from 'mongoose';
import { KardexSchema, KardexTipo } from './kardex.schema';

const KardexModel = model('KardexSchemaSpec', KardexSchema);

function entrada(cantidad: number) {
  return new KardexModel({
    productoId: new Types.ObjectId(),
    tipo: KardexTipo.VENTA,
    cantidad,
    stock: 0,
    motivo: 'Factura FAC-000012 confirmada',
  });
}

/**
 * T7b: invoice items allow fractional quantities, so the Kardex must too.
 * The only rule is "greater than 0", which every integer quantity written
 * by the other modules (compra, transferencia, kardex manual) still meets.
 */
describe('KardexSchema cantidad (T7b)', () => {
  it.each([0.5, 1, 3, 1.25])('accepts %p', (cantidad) => {
    expect(entrada(cantidad).validateSync()).toBeUndefined();
  });

  it.each([0, -1, -0.5])('rejects %p', (cantidad) => {
    const error = entrada(cantidad).validateSync();

    expect(error?.errors.cantidad?.message).toBe(
      'La cantidad debe ser mayor que 0',
    );
  });
});
