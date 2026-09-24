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

/**
 * Placeholder `direccion_cliente` assigned to an auto-created client when
 * the invoice carries no buyer address (the Cliente schema requires a
 * non-empty value, so an empty string would make the client creation fail).
 */
export const FACTURA_CLIENTE_DIRECCION_PLACEHOLDER = 'Sin dirección';

/**
 * Payment methods an invoice can be settled with (T3), matching the
 * methods already handled by the `pago` module (`Pago.metodoPago` /
 * `PagoBaseDto`, see src/modules/inventario/pago).
 *
 * Update paths only run schema validators on the paths present in the
 * update document (`runValidators: true` + Mongoose's default
 * `pathsToSkip` behavior): `UpdateFacturaDto` never accepts `metodoPago`,
 * so a legacy invoice stored with a value outside this enum keeps loading
 * and being edited normally; it just can't have its `metodoPago` changed
 * to another out-of-enum value going forward.
 */
export enum TipoPago {
  EFECTIVO = 'efectivo',
  TRANSFERENCIA = 'transferencia',
  CREDITO = 'credito',
}

/**
 * Invoice lifecycle states (T6a, spec "TABLA DE UNA FACTURA"):
 *  - `edicion`: default on create; every business field is editable and
 *    totals are recomputed server-side (T6b).
 *  - `terminada`: closed for the normal edit flow; only `fecha` and
 *    `talonario` stay editable (T6b); no inventory movement.
 *  - `confirmada`: inventory decreases (T7, not implemented by T6a).
 *  - `cancelada`: a `confirmada` invoice rolled back; inventory increases
 *    (T7).
 *  - `anulada`: terminal; its `numero`/`id` can never be reused by another
 *    invoice (the counter is never decremented on anular, see
 *    FacturaService.siguienteNumero).
 * See factura-estado.ts for the legal transitions between these states.
 */
export enum EstadoFactura {
  EDICION = 'edicion',
  TERMINADA = 'terminada',
  CONFIRMADA = 'confirmada',
  CANCELADA = 'cancelada',
  ANULADA = 'anulada',
}
