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

/** Fallback `cliente` name used when none is sent by the client. */
export const FACTURA_CLIENTE_NOMBRE_POR_DEFECTO = 'Venta al público';

/**
 * Sentinel some frontend forms send for "no value" (an em dash) instead of
 * an empty string; normalized to `''` before being stored.
 */
export const FACTURA_CAMPO_VACIO_SENTINEL = '—';

/**
 * Prefix for the placeholder `telefono_cliente` assigned to an
 * auto-created client that has no telefono (the field is unique, so it
 * can't be left blank).
 */
export const FACTURA_CLIENTE_TELEFONO_PLACEHOLDER_PREFIJO = '0';

/**
 * Domain for the placeholder `email_cliente` assigned to an auto-created
 * client that has no email (the field is unique, so it can't be left
 * blank).
 */
export const FACTURA_CLIENTE_EMAIL_PLACEHOLDER_DOMINIO = 'xilef.local';
