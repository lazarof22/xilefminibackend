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
