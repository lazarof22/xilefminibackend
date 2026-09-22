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

/** Default page (1-indexed) applied to `findAll` when none is requested. */
export const FACTURA_LISTADO_PAGINA_DEFECTO = 1;

/**
 * Default `limit` applied to `findAll` when none is requested, so listing
 * invoices is always bounded even if a caller never sends `limit`.
 */
export const FACTURA_LISTADO_LIMITE_DEFECTO = 50;

/** Maximum `limit` accepted by `findAll`/`ListarFacturasQueryDto`. */
export const FACTURA_LISTADO_LIMITE_MAXIMO = 500;
