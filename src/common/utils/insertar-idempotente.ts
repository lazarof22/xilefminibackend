import type { Model } from 'mongoose';

/** Error E11000 de MongoDB (violación de un índice único o de `_id`). */
export const esClaveDuplicada = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;

/**
 * ¿Todos los fallos de una inserción múltiple son claves duplicadas?
 * `insertMany(..., { ordered: false })` inserta lo que puede y lanza un
 * `MongoBulkWriteError` con la lista `writeErrors` (cada uno con su `code`).
 */
export function soloClavesDuplicadas(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { writeErrors } = error as { writeErrors?: unknown };
  if (Array.isArray(writeErrors) && writeErrors.length > 0) {
    return writeErrors.every((e) => {
      const fallo = e as { code?: unknown; err?: { code?: unknown } };
      return (fallo.code ?? fallo.err?.code) === 11000;
    });
  }

  return esClaveDuplicada(error);
}

/**
 * Inserta documentos con `_id` ya asignado ignorando los que ya existen.
 *
 * Es lo que hace repetible un paso de una operación: si el proceso se cayó a
 * mitad y la recuperación vuelve a ejecutar el paso, los documentos que ya se
 * habían escrito (mismo `_id`) no se duplican ni dan error. Cualquier otro
 * fallo (red, validación) sí se propaga.
 */
export async function insertarIgnorandoDuplicados<T>(
  modelo: Model<T>,
  documentos: Record<string, unknown>[],
): Promise<void> {
  if (documentos.length === 0) return;

  try {
    await modelo.insertMany(documentos, { ordered: false });
  } catch (error) {
    if (!soloClavesDuplicadas(error)) throw error;
  }
}
