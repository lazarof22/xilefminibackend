import { Model, Types } from 'mongoose';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';

/** Partes de la ubicación física que pide el Submayor SC-2-13 (doc §6.1). */
export interface PartesUbicacion {
  almacen?: string;
  contenedor?: string;
  seccion?: string;
  estante?: string;
  casilla?: string;
}

const limpio = (valor: string | undefined): string => (valor ?? '').trim();

/**
 * `"<almacén> / <contenedor> / sección S · estante E · casilla C"`; las
 * partes vacías se omiten. `undefined` si no hay ninguna.
 */
export function formatearUbicacionFisica(
  partes: PartesUbicacion,
): string | undefined {
  const puesto = [
    limpio(partes.seccion) && `sección ${limpio(partes.seccion)}`,
    limpio(partes.estante) && `estante ${limpio(partes.estante)}`,
    limpio(partes.casilla) && `casilla ${limpio(partes.casilla)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const texto = [limpio(partes.almacen), limpio(partes.contenedor), puesto]
    .filter(Boolean)
    .join(' / ');

  return texto || undefined;
}

type IdLike = string | Types.ObjectId | null | undefined;

const esId = (valor: IdLike): valor is string | Types.ObjectId =>
  valor !== null &&
  valor !== undefined &&
  Types.ObjectId.isValid(String(valor));

/**
 * Lee los nombres del almacén y del contenedor y arma la ubicación física.
 * Lo que no existe se omite (nunca lanza por una ubicación incompleta).
 */
export async function ubicacionFisicaDe(
  almacenModel: Pick<Model<Almacen>, 'findById'>,
  contenedorModel: Pick<Model<Contenedor>, 'findById'>,
  almacenId?: IdLike,
  contenedorId?: IdLike,
): Promise<string | undefined> {
  const contenedor = esId(contenedorId)
    ? await contenedorModel
        .findById(String(contenedorId))
        .select('nombreContenedor almacen seccion estante casilla')
        .lean()
        .exec()
    : null;

  const idAlmacen = esId(almacenId) ? almacenId : contenedor?.almacen;
  const almacen = esId(idAlmacen)
    ? await almacenModel
        .findById(String(idAlmacen))
        .select('nombreAlmacen')
        .lean()
        .exec()
    : null;

  return formatearUbicacionFisica({
    almacen: almacen?.nombreAlmacen,
    contenedor: contenedor?.nombreContenedor,
    seccion: contenedor?.seccion,
    estante: contenedor?.estante,
    casilla: contenedor?.casilla,
  });
}
