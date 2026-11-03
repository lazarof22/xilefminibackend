import { Types } from 'mongoose';
import {
  AsignacionDescuento,
  EPSILON,
  FilaExistencia,
  UbicacionPreferida,
  redondear,
} from './existencia.types';

const mismoId = (
  a: Types.ObjectId | string | null | undefined,
  b: Types.ObjectId | string | null | undefined,
): boolean => !!a && !!b && String(a) === String(b);

/**
 * Orden en que se consume el stock cuando quien vende no elige ubicación:
 * primero la ubicación por defecto del producto, luego la de más stock (se
 * vacían menos filas) y, a igualdad, por id para que el resultado sea siempre
 * el mismo.
 */
export function ordenarPorPolitica(
  filas: FilaExistencia[],
  preferida?: UbicacionPreferida,
): FilaExistencia[] {
  const esPreferida = (fila: FilaExistencia): boolean =>
    mismoId(fila.almacen, preferida?.almacen) &&
    mismoId(fila.contenedor, preferida?.contenedor);

  return [...filas].sort((a, b) => {
    const pa = esPreferida(a) ? 0 : 1;
    const pb = esPreferida(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.cantidad !== b.cantidad) return b.cantidad - a.cantidad;
    return String(a._id).localeCompare(String(b._id));
  });
}

/**
 * Reparte `cantidad` entre las filas con stock según la política de arriba.
 * Función pura: no toca la base de datos. `faltante` > 0 si no alcanza.
 */
export function planificarDescuento(
  filas: FilaExistencia[],
  cantidad: number,
  preferida?: UbicacionPreferida,
): { asignaciones: AsignacionDescuento[]; faltante: number } {
  let pendiente = redondear(cantidad);
  const asignaciones: AsignacionDescuento[] = [];

  for (const fila of ordenarPorPolitica(filas, preferida)) {
    if (pendiente <= EPSILON) break;
    if (fila.cantidad <= EPSILON) continue;
    const tomar = redondear(Math.min(pendiente, fila.cantidad));
    asignaciones.push({
      existenciaId: fila._id,
      almacen: fila.almacen,
      contenedor: fila.contenedor,
      cantidad: tomar,
    });
    pendiente = redondear(pendiente - tomar);
  }

  return { asignaciones, faltante: pendiente > EPSILON ? pendiente : 0 };
}

/** Une varias asignaciones de la misma ubicación en una sola. */
export function fusionarUbicaciones<
  T extends {
    almacen: Types.ObjectId;
    contenedor: Types.ObjectId;
    cantidad: number;
  },
>(
  ubicaciones: T[],
): { almacen: Types.ObjectId; contenedor: Types.ObjectId; cantidad: number }[] {
  const mapa = new Map<
    string,
    { almacen: Types.ObjectId; contenedor: Types.ObjectId; cantidad: number }
  >();
  for (const u of ubicaciones) {
    const clave = `${String(u.almacen)}|${String(u.contenedor)}`;
    const actual = mapa.get(clave);
    mapa.set(clave, {
      almacen: u.almacen,
      contenedor: u.contenedor,
      cantidad: redondear((actual?.cantidad ?? 0) + u.cantidad),
    });
  }
  return [...mapa.values()];
}
