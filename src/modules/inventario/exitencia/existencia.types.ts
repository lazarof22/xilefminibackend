import { Types } from 'mongoose';

/** Cantidad de un producto en una ubicación física (almacén + contenedor). */
export interface UbicacionCantidad {
  almacen: Types.ObjectId;
  contenedor: Types.ObjectId;
  cantidad: number;
}

/** Fila de existencia con lo mínimo que necesita la política de asignación. */
export interface FilaExistencia {
  _id: Types.ObjectId;
  almacen: Types.ObjectId;
  contenedor: Types.ObjectId;
  cantidad: number;
}

/** Parte de un descuento que sale de una fila concreta. */
export interface AsignacionDescuento extends UbicacionCantidad {
  existenciaId: Types.ObjectId;
}

/** Resultado de mover stock de un producto (descontar o reponer). */
export interface ResultadoMovimiento {
  /** Ubicaciones que cambiaron y cuánto cambió cada una. */
  ubicaciones: UbicacionCantidad[];
  /** Stock total del producto después del movimiento (suma de ubicaciones). */
  stockTotal: number;
}

/** Qué arregló `normalizarExistencias`. */
export interface ResultadoNormalizacion {
  /** Filas cuyos ids de texto pasaron a ObjectId. */
  convertidas: number;
  /** Filas sobrantes de una ubicación repetida, sumadas en la que se conserva. */
  fusionadas: number;
}

/** Ubicación preferida al descontar: la ubicación por defecto del producto. */
export interface UbicacionPreferida {
  almacen?: Types.ObjectId | string | null;
  contenedor?: Types.ObjectId | string | null;
}

/** Tolerancia para comparar cantidades decimales (se admiten fracciones). */
export const EPSILON = 1e-9;

/**
 * Margen con el que la base de datos compara un saldo con una cantidad a
 * descontar. Los decimales binarios arrastran residuos (0.7 − 0.4 da
 * 0.29999999999999993): sin margen, vender "los 0.3 que quedan" fallaría.
 * Es la mitad del redondeo a 6 decimales: acepta todo saldo que, redondeado,
 * alcanza la cantidad pedida y ninguno que no la alcance.
 */
export const TOLERANCIA_SALDO = 5e-7;

/** Redondea a 6 decimales para que las sumas de fracciones no arrastren error. */
export const redondear = (valor: number): number =>
  Math.round((valor + Number.EPSILON) * 1e6) / 1e6;

// ─── Ids guardados como ObjectId o como texto ─────────────────────
//
// Casi todos los esquemas del proyecto declaran sus ids con
// `@Prop({ type: Types.ObjectId })`, que Mongoose 9 trata como `Mixed`: guarda
// lo que le llega, sin convertir. Por eso en la base real conviven los dos
// tipos: `contenedores.almacen`, `productos.almacen` y `productos.contenedor`
// están guardados con el TEXTO que mandó el formulario, y algunas existencias
// antiguas (las que crea `sincronizarUbicacionInicial` copiando el producto)
// también. Una consulta con ObjectId no encuentra un id guardado como texto, y
// al revés. Estos ayudantes aceptan las dos formas.

const ID_EN_TEXTO = /^[0-9a-fA-F]{24}$/;

/** Un id (ObjectId o su texto de 24 caracteres) como ObjectId; `undefined` si no lo es. */
export function aObjectId(valor: unknown): Types.ObjectId | undefined {
  if (valor instanceof Types.ObjectId) {
    return valor;
  }

  if (typeof valor === 'string' && ID_EN_TEXTO.test(valor)) {
    return new Types.ObjectId(valor);
  }

  if (
    typeof valor === 'object' &&
    valor !== null &&
    (valor as { _bsontype?: unknown })._bsontype === 'ObjectId'
  ) {
    return new Types.ObjectId(
      (valor as { toHexString: () => string }).toHexString(),
    );
  }

  return undefined;
}

/**
 * Las dos formas en que puede estar guardado un id en un campo `Mixed`
 * (ObjectId y texto), para filtrar con `$in` sin perder las filas antiguas.
 */
export function ambosTipos(id: Types.ObjectId): [Types.ObjectId, string] {
  return [id, id.toHexString()];
}

/** ¿Está guardado como texto en vez de como ObjectId? */
export const esIdEnTexto = (valor: unknown): boolean =>
  typeof valor === 'string';
