/**
 * Validates that `timezone` is a IANA timezone `Intl` can resolve, so a
 * misconfigured `FACTURA_TIMEZONE` fails fast at startup instead of
 * silently producing wrong invoice dates on every `create()` call. Throws
 * synchronously with a clear message when it is not.
 */
export function validarZonaHoraria(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch (err) {
    throw new Error(
      `FACTURA_TIMEZONE invalida: "${timezone}" no es una zona horaria IANA reconocida (${String(err)})`,
    );
  }
}

/**
 * Computes the invoice date as `YYYY-MM-DD` in a given IANA timezone.
 * The previous implementation used `new Date().toISOString().split('T')[0]`,
 * which is always UTC and can be off by one day around midnight in Cuba.
 */
export function obtenerFechaEnZona(
  timezone: string,
  fecha: Date = new Date(),
): string {
  // en-CA formats as YYYY-MM-DD, which matches the invoice's date format.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}
