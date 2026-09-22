/**
 * Fixed document id used by the atomic invoice-numbering counter
 * (collection `factura_contadores`).
 */
export const FACTURA_CONTADOR_ID = 'factura';

/**
 * IANA timezone used to compute the default invoice date.
 * Overridable via `FACTURA_TIMEZONE` for deployments outside Cuba.
 */
export const FACTURA_TIMEZONE: string =
  process.env.FACTURA_TIMEZONE ?? 'America/Havana';
