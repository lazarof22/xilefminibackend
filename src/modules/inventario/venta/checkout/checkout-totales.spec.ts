import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  DESCUENTO_MAXIMO_POR_DEFECTO,
  descuentoMaximoPara,
  validarDescuentos,
} from './checkout-politica';
import {
  calcularVenta,
  EntradaLinea,
  repartirCentimos,
} from './checkout-totales';

const producto = (
  nombre: string,
  precio: number,
): EntradaLinea['producto'] => ({
  _id: new Types.ObjectId(),
  codigo_producto: nombre.slice(0, 3).toUpperCase(),
  nombre_producto: nombre,
  precio_venta: precio,
});

const linea = (
  nombre: string,
  precio: number,
  cantidad: number,
  descuentoPct = 0,
): EntradaLinea => ({
  producto: producto(nombre, precio),
  cantidad,
  descuentoPct,
});

/** En céntimos, para comparar sumas sin errores de coma flotante. */
const cent = (n: number): number => Math.round(n * 100);

describe('calcularVenta — totales que calcula el servidor', () => {
  it('sin impuesto ni descuento: subtotal = total', () => {
    const { lineas, totales } = calcularVenta(
      [linea('Arroz', 100, 2), linea('Frijol', 50, 3)],
      0,
    );

    expect(totales).toEqual({
      subtotal: 350,
      descuento: 0,
      base: 350,
      impuestoPorciento: 0,
      impuesto: 0,
      total: 350,
    });
    expect(lineas.map((l) => l.total)).toEqual([200, 150]);
    expect(lineas.map((l) => l.impuesto)).toEqual([0, 0]);
  });

  it('descuento por línea e impuesto sobre la base, como la factura', () => {
    const { lineas, totales } = calcularVenta(
      [linea('Arroz', 100, 2, 10), linea('Frijol', 50, 3)],
      10,
    );

    expect(totales).toEqual({
      subtotal: 350,
      descuento: 20,
      base: 330,
      impuestoPorciento: 10,
      impuesto: 33,
      total: 363,
    });
    // El descuento afecta solo a la línea que lo tiene.
    expect(lineas[0]).toMatchObject({
      bruto: 200,
      descuentoMonto: 20,
      neto: 180,
      impuesto: 18,
      total: 198,
    });
    expect(lineas[1]).toMatchObject({
      bruto: 150,
      descuentoMonto: 0,
      neto: 150,
      impuesto: 15,
      total: 165,
    });
  });

  it('el impuesto repartido por línea suma EXACTAMENTE el de la venta (mayor resto)', () => {
    // 3 × 33,33 = 99,99; 10 % = 9,999 → 10,00 que no se divide en tres partes iguales.
    const { lineas, totales } = calcularVenta(
      [linea('A', 33.33, 1), linea('B', 33.33, 1), linea('C', 33.33, 1)],
      10,
    );

    expect(totales.base).toBe(99.99);
    expect(totales.impuesto).toBe(10);
    expect(totales.total).toBe(109.99);
    expect(lineas.map((l) => l.impuesto)).toEqual([3.34, 3.33, 3.33]);
    expect(lineas.map((l) => l.total)).toEqual([36.67, 36.66, 36.66]);
    expect(cent(lineas.reduce((s, l) => s + l.total, 0))).toBe(
      cent(totales.total),
    );
  });

  it('ni siquiera con carritos al azar descuadran las líneas contra los totales', () => {
    // Generador determinista: la prueba no puede ser distinta cada vez.
    let semilla = 12345;
    const azar = (): number => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla / 2147483648;
    };

    for (let ronda = 0; ronda < 300; ronda++) {
      const lineasEntrada = Array.from(
        { length: 1 + Math.floor(azar() * 6) },
        (_, i) =>
          linea(
            `P${i}`,
            Math.round(azar() * 20000) / 100,
            1 + Math.floor(azar() * 7) + Math.round(azar() * 100) / 100,
            Math.floor(azar() * 4) * 5,
          ),
      );
      const impuesto = [0, 5, 7.5, 10, 13][Math.floor(azar() * 5)];

      const { lineas, totales } = calcularVenta(lineasEntrada, impuesto);

      const suma = (campo: 'total' | 'impuesto' | 'descuentoMonto' | 'bruto') =>
        cent(lineas.reduce((s, l) => s + l[campo], 0));

      expect(suma('total')).toBe(cent(totales.total));
      expect(suma('impuesto')).toBe(cent(totales.impuesto));
      expect(suma('descuentoMonto')).toBe(cent(totales.descuento));
      expect(suma('bruto')).toBe(cent(totales.subtotal));
      expect(cent(totales.subtotal - totales.descuento)).toBe(
        cent(totales.base),
      );
      expect(cent(totales.base + totales.impuesto)).toBe(cent(totales.total));
    }
  });

  it('un precio inválido en la base detiene la venta con un error claro', () => {
    expect(() => calcularVenta([linea('Roto', -5, 1)], 0)).toThrow(
      BadRequestException,
    );
    expect(() => calcularVenta([linea('Roto', Number.NaN, 1)], 0)).toThrow(
      /precio de venta válido/,
    );
  });

  it('descuento del 100 % deja la línea en 0', () => {
    const { lineas, totales } = calcularVenta(
      [linea('Regalo', 80, 1, 100)],
      10,
    );

    expect(lineas[0].total).toBe(0);
    expect(totales.total).toBe(0);
    expect(totales.descuento).toBe(80);
  });
});

describe('repartirCentimos', () => {
  it('reparte sin perder ni inventar céntimos', () => {
    expect(repartirCentimos(10, [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
    expect(repartirCentimos(0.01, [1, 1, 1])).toEqual([0.01, 0, 0]);
  });

  it('total cero o pesos en cero reparte ceros', () => {
    expect(repartirCentimos(0, [5, 5])).toEqual([0, 0]);
    expect(repartirCentimos(10, [0, 0])).toEqual([0, 0]);
  });

  it('respeta el peso de cada línea', () => {
    expect(repartirCentimos(33, [180, 150])).toEqual([18, 15]);
  });
});

describe('política de descuento por rol', () => {
  it('por defecto todos los roles pueden hasta el 100 % (como antes del checkout)', () => {
    expect(descuentoMaximoPara('cajero')).toBe(100);
    expect(descuentoMaximoPara('administrador')).toBe(100);
    expect(() => validarDescuentos([0, 50, 100], 'cajero')).not.toThrow();
  });

  it('con un tope por rol, rechaza (403) lo que lo supere y acepta lo que no', () => {
    const tabla = { cajero: 10, gerente: 50 };

    expect(descuentoMaximoPara('cajero', tabla)).toBe(10);
    expect(() => validarDescuentos([5, 10], 'cajero', tabla)).not.toThrow();
    expect(() => validarDescuentos([5, 10.5], 'cajero', tabla)).toThrow(
      ForbiddenException,
    );
    expect(() => validarDescuentos([40], 'gerente', tabla)).not.toThrow();
  });

  it('un rol que no está en la tabla usa el tope por defecto', () => {
    expect(descuentoMaximoPara('rol-nuevo', {})).toBe(
      DESCUENTO_MAXIMO_POR_DEFECTO,
    );
  });
});
