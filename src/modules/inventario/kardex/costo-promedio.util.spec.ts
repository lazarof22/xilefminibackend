import { Types } from 'mongoose';
import { FakeModel } from '../exitencia/fake-mongo-spec';
import {
  calcularCostoPromedio,
  costoParaEntrada,
  costoVigente,
  valuarMovimiento,
} from './costo-promedio.util';
import { ultimoCostoPromedio } from './costo-promedio.consulta';

describe('calcularCostoPromedio (promedio móvil ponderado)', () => {
  it('ejemplo: 10 u a 5,00 + 10 u a 8,00 → 6,50', () => {
    expect(
      calcularCostoPromedio({
        stockAnterior: 10,
        costoPromedioAnterior: 5,
        cantidad: 10,
        costoUnitario: 8,
      }),
    ).toBe(6.5);
  });

  it('pondera por cantidad: 30 u a 2,00 + 10 u a 4,00 → 2,50', () => {
    expect(
      calcularCostoPromedio({
        stockAnterior: 30,
        costoPromedioAnterior: 2,
        cantidad: 10,
        costoUnitario: 4,
      }),
    ).toBe(2.5);
  });

  it('redondea a 2 decimales: 3 u a 1,00 + 1 u a 2,00 → 1,25 y 2 u a 1,00 + 1 u a 2,00 → 1,33', () => {
    expect(
      calcularCostoPromedio({
        stockAnterior: 3,
        costoPromedioAnterior: 1,
        cantidad: 1,
        costoUnitario: 2,
      }),
    ).toBe(1.25);
    expect(
      calcularCostoPromedio({
        stockAnterior: 2,
        costoPromedioAnterior: 1,
        cantidad: 1,
        costoUnitario: 2,
      }),
    ).toBe(1.33);
  });

  it.each([0, -3])(
    'sin saldo previo (%s) el promedio es el costo de la entrada',
    (stockAnterior) => {
      expect(
        calcularCostoPromedio({
          stockAnterior,
          costoPromedioAnterior: 99,
          cantidad: 4,
          costoUnitario: 7.25,
        }),
      ).toBe(7.25);
    },
  );

  it('una entrada sin costo (0) baja el promedio: 10 u a 6,00 + 10 u a 0 → 3,00', () => {
    expect(
      calcularCostoPromedio({
        stockAnterior: 10,
        costoPromedioAnterior: 6,
        cantidad: 10,
        costoUnitario: 0,
      }),
    ).toBe(3);
  });

  it('admite cantidades fraccionarias', () => {
    expect(
      calcularCostoPromedio({
        stockAnterior: 0.5,
        costoPromedioAnterior: 10,
        cantidad: 1.5,
        costoUnitario: 20,
      }),
    ).toBe(17.5);
  });
});

describe('costoParaEntrada (orden de respaldo del promedio anterior)', () => {
  it('1) usa el costoPromedio del último movimiento del kardex', () => {
    expect(
      costoParaEntrada({
        ultimoPromedio: 5,
        precioCompra: 9,
        stockAnterior: 10,
        cantidad: 10,
        costoUnitario: 8,
      }),
    ).toBe(6.5);
  });

  it('2) sin kardex previo usa Producto.precio_compra', () => {
    expect(
      costoParaEntrada({
        precioCompra: 4,
        stockAnterior: 10,
        cantidad: 10,
        costoUnitario: 8,
      }),
    ).toBe(6);
  });

  it('3) sin kardex ni precio_compra usa el costo de la entrada', () => {
    expect(
      costoParaEntrada({
        stockAnterior: 10,
        cantidad: 10,
        costoUnitario: 8,
      }),
    ).toBe(8);
  });

  it('un precio_compra en 0 o ausente cuenta como desconocido', () => {
    expect(
      costoParaEntrada({
        precioCompra: 0,
        stockAnterior: 10,
        cantidad: 10,
        costoUnitario: 8,
      }),
    ).toBe(8);
  });

  it('un promedio previo de 0 (mercancía sin costo) sí es un dato conocido', () => {
    expect(
      costoParaEntrada({
        ultimoPromedio: 0,
        precioCompra: 9,
        stockAnterior: 10,
        cantidad: 10,
        costoUnitario: 8,
      }),
    ).toBe(4);
  });
});

describe('costoVigente (lo que registra una salida)', () => {
  it('prefiere el promedio del kardex, luego precio_compra', () => {
    expect(costoVigente(5, 9)).toBe(5);
    expect(costoVigente(undefined, 9)).toBe(9);
  });

  it('sin ninguno de los dos es desconocido (no se inventa)', () => {
    expect(costoVigente(undefined, undefined)).toBeUndefined();
    expect(costoVigente(undefined, 0)).toBeUndefined();
  });
});

describe('valuarMovimiento', () => {
  it('importeCUP = cantidad × costo, redondeado a 2 decimales', () => {
    expect(valuarMovimiento(3, 6.5)).toEqual({
      costoPromedio: 6.5,
      importeCUP: 19.5,
    });
    expect(valuarMovimiento(3, 1.33)).toEqual({
      costoPromedio: 1.33,
      importeCUP: 3.99,
    });
  });

  it('sin costo conocido no escribe ningún campo contable', () => {
    expect(valuarMovimiento(3, undefined)).toEqual({});
  });
});

describe('ultimoCostoPromedio', () => {
  const P = new Types.ObjectId();
  const OTRO = new Types.ObjectId();

  it('devuelve el costoPromedio de la fila MÁS RECIENTE del producto que lo tenga', async () => {
    const kardex = new FakeModel([
      { productoId: P, costoPromedio: 3 },
      { productoId: OTRO, costoPromedio: 99 },
      { productoId: P, costoPromedio: 4.5 },
      { productoId: P },
    ]);

    expect(await ultimoCostoPromedio(kardex as never, P)).toBe(4.5);
  });

  it('encuentra filas cuyo productoId quedó guardado como texto', async () => {
    const kardex = new FakeModel([
      { productoId: P.toHexString(), costoPromedio: 2 },
    ]);

    expect(await ultimoCostoPromedio(kardex as never, P.toHexString())).toBe(2);
  });

  it('es undefined si ninguna fila del producto tiene promedio', async () => {
    const kardex = new FakeModel([{ productoId: P }]);

    expect(await ultimoCostoPromedio(kardex as never, P)).toBeUndefined();
  });
});
