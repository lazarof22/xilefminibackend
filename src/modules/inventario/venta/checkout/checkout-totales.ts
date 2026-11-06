import { BadRequestException } from '@nestjs/common';
import type { Types } from 'mongoose';
import {
  calcularTotales,
  ItemFacturaEntrada,
  redondear,
} from '../../../factura/factura-totales';

/** Lo que el checkout necesita de un producto (leído de la base, no del cliente). */
export interface ProductoParaVenta {
  _id: Types.ObjectId;
  codigo_producto: string;
  nombre_producto: string;
  precio_venta: number;
  stock_minimo?: number;
}

export interface EntradaLinea {
  producto: ProductoParaVenta;
  cantidad: number;
  descuentoPct: number;
}

export interface LineaCalculada {
  indice: number;
  productoId: Types.ObjectId;
  codigo: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  /** Precio × cantidad, antes del descuento. */
  bruto: number;
  descuentoMonto: number;
  /** Bruto − descuento (base imponible de la línea). */
  neto: number;
  /** La parte del impuesto de la venta que corresponde a esta línea. */
  impuesto: number;
  /** Neto + impuesto. */
  total: number;
}

export interface TotalesVenta {
  subtotal: number;
  descuento: number;
  /** Subtotal − descuento. */
  base: number;
  impuestoPorciento: number;
  impuesto: number;
  total: number;
}

/**
 * Reparte `total` (en céntimos exactos) entre las líneas según su peso, con el
 * método del mayor resto: la suma de las partes es SIEMPRE igual a `total`.
 * Sin esto, el impuesto de cada línea redondeado por separado no cuadraría con
 * el de la venta.
 */
export function repartirCentimos(total: number, pesos: number[]): number[] {
  const totalCentimos = Math.round(redondear(total) * 100);
  const sumaPesos = pesos.reduce((suma, p) => suma + p, 0);

  if (totalCentimos === 0 || sumaPesos <= 0) {
    return pesos.map(() => 0);
  }

  const exactos = pesos.map((p) => (totalCentimos * p) / sumaPesos);
  const partes = exactos.map((e) => Math.floor(e));
  let faltan = totalCentimos - partes.reduce((suma, p) => suma + p, 0);

  const porResto = exactos
    .map((e, i) => ({ i, resto: e - Math.floor(e) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (const { i } of porResto) {
    if (faltan <= 0) break;
    partes[i] += 1;
    faltan -= 1;
  }

  return partes.map((p) => p / 100);
}

/**
 * Líneas y totales de una venta, con la MISMA fórmula que la factura
 * (`calcularTotales`): el descuento se calcula por línea sobre su importe, el
 * impuesto sobre la base y todo se redondea a 2 decimales. Los precios vienen
 * de los productos, nunca del cliente.
 */
export function calcularVenta(
  entradas: EntradaLinea[],
  impuestoPorciento: number,
): { lineas: LineaCalculada[]; totales: TotalesVenta } {
  const items: ItemFacturaEntrada[] = entradas.map((e, i) => {
    const precio = Number(e.producto.precio_venta);

    if (!Number.isFinite(precio) || precio < 0) {
      throw new BadRequestException(
        `El producto "${e.producto.nombre_producto}" no tiene un precio de venta válido`,
      );
    }

    return {
      id: String(i),
      productoId: String(e.producto._id),
      productoNombre: e.producto.nombre_producto,
      cantidad: e.cantidad,
      precio,
      costo: 0,
      descuentoPct: e.descuentoPct,
      descuentoMonto: 0,
      recargo: 0,
    };
  });

  const calculado = calcularTotales(items, {
    tipo: 'impuesto-ventas',
    porciento: impuestoPorciento,
  });

  const impuestoTotal = calculado.impuesto?.importe ?? 0;
  const impuestoPorLinea = repartirCentimos(
    impuestoTotal,
    calculado.items.map((i) => i.total),
  );

  const lineas: LineaCalculada[] = calculado.items.map((item, i) => {
    const bruto = redondear(item.precio * item.cantidad);

    return {
      indice: i,
      productoId: entradas[i].producto._id,
      codigo: entradas[i].producto.codigo_producto,
      nombre: entradas[i].producto.nombre_producto,
      cantidad: item.cantidad,
      precioUnitario: item.precio,
      descuentoPct: item.descuentoPct,
      bruto,
      descuentoMonto: redondear(bruto - item.total),
      neto: item.total,
      impuesto: impuestoPorLinea[i],
      total: redondear(item.total + impuestoPorLinea[i]),
    };
  });

  return {
    lineas,
    totales: {
      subtotal: calculado.subtotal,
      descuento: calculado.descuentoTotal,
      base: redondear(calculado.subtotal - calculado.descuentoTotal),
      impuestoPorciento,
      impuesto: impuestoTotal,
      total: calculado.total,
    },
  };
}
