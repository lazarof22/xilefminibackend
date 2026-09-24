/**
 * Type guard for a MongoDB duplicate key error (E11000), thrown when the
 * unique `codigo` index rejects an insert/update that collides with an
 * existing almacén. Mirrors `factura-mongo-errors.ts` (kept local to this
 * module to avoid a cross-module dependency for a one-line check).
 */
export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 11000
  );
}
