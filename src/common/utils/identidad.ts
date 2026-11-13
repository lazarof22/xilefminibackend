/**
 * Identidad de un cliente y su teléfono: se usa en el cliente, en el pago a
 * crédito y en el diálogo del punto de venta, y debe decir lo mismo en todos.
 */

/** CI (persona natural) o NIT (empresa o mipyme). */
export const TIPOS_IDENTIDAD = ['CI', 'NIT'] as const;
export type TipoIdentidad = (typeof TIPOS_IDENTIDAD)[number];

/** La CI cubana: exactamente 11 dígitos. */
export const PATRON_CI = /^\d{11}$/;

/**
 * El NIT no tiene un formato publicado que se pueda comprobar, así que solo se
 * exige que sea razonable: de 5 a 20 letras, números o guiones.
 */
export const PATRON_NIT = /^[A-Za-z0-9-]{5,20}$/;

/** Prefijo de país del teléfono: +53, +1, +34... */
export const PATRON_CODIGO_PAIS = /^\+\d{1,4}$/;

export const CODIGO_PAIS_POR_DEFECTO = '+53';
