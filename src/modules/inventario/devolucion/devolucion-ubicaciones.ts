import { Types } from 'mongoose';
import {
  EPSILON,
  UbicacionCantidad,
  redondear,
} from '../exitencia/existencia.types';

/** Reparto de una cantidad entre las ubicaciones del documento de origen. */
export interface RepartoUbicaciones {
  /** Ubicaciones (con su cantidad) a las que corresponde la cantidad. */
  ubicaciones: UbicacionCantidad[];
  /** Parte sin ubicación de origen conocida (se mueve con la política por defecto). */
  resto: number;
}

/**
 * Reparte `cantidad` entre las ubicaciones de las que salió el producto en el
 * origen, recorriéndolas en orden y saltando lo que ya se devolvió antes
 * (`previo`). Así devoluciones sucesivas del mismo origen llenan, una tras
 * otra, las ubicaciones originales sin pasarse de lo que salió de cada una.
 *
 * Lo que no cabe en las ubicaciones conocidas (origen anterior a las
 * ubicaciones por línea) queda en `resto`.
 */
export function repartirEnUbicaciones(
  origen: UbicacionCantidad[],
  previo: number,
  cantidad: number,
): RepartoUbicaciones {
  const ubicaciones: UbicacionCantidad[] = [];
  let saltar = previo;
  let pendiente = cantidad;

  for (const u of origen) {
    if (pendiente <= EPSILON) break;

    const disponibleEnFila = redondear(u.cantidad - Math.max(0, saltar));
    saltar = redondear(Math.max(0, saltar - u.cantidad));

    if (disponibleEnFila <= EPSILON) continue;

    const tomar = Math.min(disponibleEnFila, pendiente);
    ubicaciones.push({
      almacen: u.almacen,
      contenedor: u.contenedor,
      cantidad: redondear(tomar),
    });
    pendiente = redondear(pendiente - tomar);
  }

  return { ubicaciones, resto: pendiente > EPSILON ? pendiente : 0 };
}

/** Junta las ubicaciones repetidas (mismo almacén y contenedor) sumando sus cantidades. */
export function fusionarOrigen(
  filas: { almacen: unknown; contenedor: unknown; cantidad: number }[],
): UbicacionCantidad[] {
  const mapa = new Map<string, UbicacionCantidad>();

  for (const f of filas) {
    if (!(f.cantidad > 0)) continue;
    const almacen = new Types.ObjectId(String(f.almacen));
    const contenedor = new Types.ObjectId(String(f.contenedor));
    const clave = `${almacen.toHexString()}:${contenedor.toHexString()}`;
    const actual = mapa.get(clave);
    if (actual) {
      actual.cantidad = redondear(actual.cantidad + f.cantidad);
    } else {
      mapa.set(clave, { almacen, contenedor, cantidad: f.cantidad });
    }
  }

  return [...mapa.values()];
}
