/**
 * Type guard for a MongoDB duplicate key error (E11000), thrown when a
 * unique index (e.g. Cliente.telefono_cliente/email_cliente) rejects an
 * insert that lost a race with a concurrent one.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 11000
  );
}
