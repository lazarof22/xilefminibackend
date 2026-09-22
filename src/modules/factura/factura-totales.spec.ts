import { calcularTotales, redondear } from './factura-totales';

describe('redondear', () => {
  it('rounds to 2 decimals', () => {
    expect(redondear(1.005)).toBeCloseTo(1.01, 2);
    expect(redondear(10.005)).toBeCloseTo(10.0, 1);
    expect(redondear(3.14159)).toBe(3.14);
  });
});

describe('calcularTotales (T2)', () => {
  const item = (
    overrides: Partial<{
      cantidad: number;
      precio: number;
      descuentoPct: number;
      descuentoMonto: number;
      recargo: number;
    }> = {},
  ) => ({
    id: 'item-1',
    productoId: 'prod-1',
    productoNombre: 'Producto 1',
    cantidad: 2,
    precio: 100,
    costo: 40,
    descuentoPct: 0,
    descuentoMonto: 0,
    recargo: 0,
    ...overrides,
  });

  it('computes a single line with no discounts/surcharges/tax', () => {
    const resultado = calcularTotales([item()], undefined);

    expect(resultado.items[0].total).toBe(200);
    expect(resultado.subtotal).toBe(200);
    expect(resultado.descuentoTotal).toBe(0);
    expect(resultado.recargoTotal).toBe(0);
    expect(resultado.total).toBe(200);
    expect(resultado.impuesto).toBeUndefined();
  });

  it('applies percentage and flat discounts, and a surcharge, per line', () => {
    // gross = 100*2=200; lineDiscount = 10 + 200*10/100 = 30; total = max(0,200-30+5)=175
    const resultado = calcularTotales(
      [item({ descuentoPct: 10, descuentoMonto: 10, recargo: 5 })],
      undefined,
    );

    expect(resultado.items[0].total).toBe(175);
    expect(resultado.subtotal).toBe(200);
    expect(resultado.descuentoTotal).toBe(30);
    expect(resultado.recargoTotal).toBe(5);
    expect(resultado.total).toBe(175);
  });

  it('clamps a line total at 0 when discounts exceed the gross amount', () => {
    const resultado = calcularTotales(
      [item({ cantidad: 1, precio: 10, descuentoMonto: 50 })],
      undefined,
    );

    expect(resultado.items[0].total).toBe(0);
  });

  it('sums multiple lines into subtotal/descuentoTotal/recargoTotal/total', () => {
    const resultado = calcularTotales(
      [item(), item({ cantidad: 1, precio: 50 })],
      undefined,
    );

    // line1 total=200, line2 total=50 -> base=250
    expect(resultado.subtotal).toBe(250);
    expect(resultado.total).toBe(250);
  });

  it('computes tax importe from porciento, ignoring any client-sent importe', () => {
    const resultado = calcularTotales([item()], {
      tipo: 'ISV',
      porciento: 10,
      importe: 999,
    });

    // base = 200, importe = 200*10/100 = 20
    expect(resultado.impuesto).toEqual({
      tipo: 'ISV',
      porciento: 10,
      importe: 20,
    });
    expect(resultado.total).toBe(220);
  });

  it('uses the client-sent importe when porciento is not set, including 0', () => {
    const resultado = calcularTotales([item()], { tipo: 'ISV', importe: 0 });

    expect(resultado.impuesto).toEqual({ tipo: 'ISV', importe: 0 });
    expect(resultado.total).toBe(200);
  });

  it('has no tax when neither porciento nor importe are set', () => {
    const resultado = calcularTotales([item()], { tipo: 'ISV' });

    expect(resultado.impuesto).toEqual({ tipo: 'ISV' });
    expect(resultado.total).toBe(200);
  });
});
