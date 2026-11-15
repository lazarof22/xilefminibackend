/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Types } from 'mongoose';
import { calcularTotales } from '../../../factura/factura-totales';
import { calcularVenta, EntradaLinea } from './checkout-totales';
import {
  claveNueva,
  crearEntorno,
  dtoCheckout,
  silenciarLogs,
} from './checkout-entorno-spec';

/**
 * Productos exentos (§6.7): el impuesto sobre ventas solo recae sobre las
 * líneas gravadas; las exentas pagan exactamente su neto.
 */

const linea = (
  nombre: string,
  precio: number,
  cantidad: number,
  descuentoPct = 0,
  gravado?: 'gravado' | 'exento',
): EntradaLinea => ({
  producto: {
    _id: new Types.ObjectId(),
    codigo_producto: nombre.slice(0, 3).toUpperCase(),
    nombre_producto: nombre,
    precio_venta: precio,
    ...(gravado ? { gravado } : {}),
  },
  cantidad,
  descuentoPct,
});

const cent = (n: number): number => Math.round(n * 100);

describe('calcularTotales — items exentos', () => {
  const item = (id: string, precio: number, exento?: boolean) => ({
    id,
    productoId: id,
    productoNombre: id,
    cantidad: 1,
    precio,
    costo: 0,
    descuentoPct: 0,
    descuentoMonto: 0,
    recargo: 0,
    ...(exento === undefined ? {} : { exento }),
  });

  it('el impuesto solo suma la base de los items no exentos', () => {
    const r = calcularTotales([item('a', 100), item('b', 50, true)], {
      tipo: 'impuesto-ventas',
      porciento: 10,
    });

    expect(r.impuesto?.importe).toBe(10);
    expect(r.total).toBe(160);
  });

  it('sin la marca (o con exento false) todo se calcula como antes', () => {
    const sinMarca = calcularTotales([item('a', 100), item('b', 50)], {
      tipo: 'impuesto-ventas',
      porciento: 10,
    });
    const conFalse = calcularTotales(
      [item('a', 100, false), item('b', 50, false)],
      { tipo: 'impuesto-ventas', porciento: 10 },
    );

    expect(sinMarca.impuesto?.importe).toBe(15);
    expect(sinMarca.total).toBe(165);
    expect(conFalse.impuesto).toEqual(sinMarca.impuesto);
    expect(conFalse.total).toBe(sinMarca.total);
  });
});

describe('calcularVenta — productos exentos', () => {
  it('mezcla gravado + exento: el impuesto solo recae sobre la base gravada (con descuento en la exenta)', () => {
    const { lineas, totales } = calcularVenta(
      [
        linea('Arroz', 100, 2, 10, 'gravado'), // neto 180
        linea('Medicina', 50, 3, 20, 'exento'), // bruto 150, neto 120
      ],
      10,
    );

    expect(totales).toEqual({
      subtotal: 350,
      descuento: 50,
      base: 300, // venta neta completa (gravada + exenta)
      impuestoPorciento: 10,
      impuesto: 18, // 10 % de 180, no de 300
      total: 318,
    });
    expect(lineas[0]).toMatchObject({ neto: 180, impuesto: 18, total: 198 });
    expect(lineas[1]).toMatchObject({
      bruto: 150,
      descuentoMonto: 30,
      neto: 120,
      impuesto: 0,
      total: 120,
    });
    expect(cent(lineas.reduce((s, l) => s + l.total, 0))).toBe(
      cent(totales.total),
    );
    expect(cent(lineas.reduce((s, l) => s + l.impuesto, 0))).toBe(
      cent(totales.impuesto),
    );
  });

  it('todo exento: impuesto 0 y total = base', () => {
    const { lineas, totales } = calcularVenta(
      [linea('Medicina', 50, 3, 0, 'exento'), linea('Pan', 10, 1, 0, 'exento')],
      10,
    );

    expect(totales.impuesto).toBe(0);
    expect(totales.base).toBe(160);
    expect(totales.total).toBe(160);
    expect(lineas.map((l) => l.impuesto)).toEqual([0, 0]);
    expect(lineas.map((l) => l.total)).toEqual(lineas.map((l) => l.neto));
  });

  it('el reparto por mayor resto entre varias gravadas ignora a las exentas', () => {
    const { lineas, totales } = calcularVenta(
      [
        linea('A', 33.33, 1, 0, 'gravado'),
        linea('X', 500, 1, 0, 'exento'),
        linea('B', 33.33, 1, 0, 'gravado'),
        linea('C', 33.33, 1, 0, 'gravado'),
      ],
      10,
    );

    expect(totales.impuesto).toBe(10);
    expect(lineas.map((l) => l.impuesto)).toEqual([3.34, 0, 3.33, 3.33]);
    expect(lineas[1].total).toBe(lineas[1].neto);
    expect(cent(totales.base + totales.impuesto)).toBe(cent(totales.total));
  });

  it('todo gravado (explícito o sin el campo) da el mismo resultado que antes', () => {
    const entradas = (g?: 'gravado') => [
      linea('Arroz', 100, 2, 10, g),
      linea('Frijol', 50, 3, 0, g),
      linea('Aceite', 33.33, 1, 5, g),
    ];

    const explicito = calcularVenta(entradas('gravado'), 10);
    const implicito = calcularVenta(entradas(), 10);

    expect(explicito.totales).toEqual(implicito.totales);
    expect(explicito.lineas.map(({ productoId, ...r }) => r)).toEqual(
      implicito.lineas.map(({ productoId, ...r }) => r),
    );
    // Valores fijos de la fórmula original (impuesto sobre toda la base).
    expect(implicito.totales).toEqual({
      subtotal: 383.33,
      descuento: 21.67,
      base: 361.66,
      impuestoPorciento: 10,
      impuesto: 36.17,
      total: 397.83,
    });
  });
});

describe('CheckoutService.ejecutar — producto exento', () => {
  let restaurar: () => void;
  beforeEach(() => {
    restaurar = silenciarLogs();
  });
  afterEach(() => restaurar());

  it('la venta persistida y la respuesta cobran impuesto solo sobre lo gravado', async () => {
    const e = crearEntorno({ impuesto: 10 });
    // [0] Arroz 100 (gravado) · [1] Frijol 50 (exento)
    e.modelos.productos.porId(e.P[1])!.gravado = 'exento';

    const { respuesta } = await e.checkout.ejecutar(
      dtoCheckout(e, [
        { i: 0, cantidad: 2 },
        { i: 1, cantidad: 3, descuentoPct: 20 },
      ]),
      claveNueva(),
      e.usuario('gerente'),
    );

    // Arroz 200 → impuesto 20; Frijol 150 − 30 = 120 exento.
    const venta = e.modelos.ventas.docs[0];
    expect(venta.impuesto).toBe(20);
    expect(venta.total).toBe(340);
    expect(venta.productos.map((l: any) => l.impuesto)).toEqual([20, 0]);
    expect(venta.productos.map((l: any) => l.total)).toEqual([220, 120]);

    expect(respuesta.venta.impuesto).toBe(venta.impuesto);
    expect(respuesta.venta.total).toBe(venta.total);
    expect(respuesta.venta.items.map((l) => l.impuesto)).toEqual([20, 0]);
  });
});
