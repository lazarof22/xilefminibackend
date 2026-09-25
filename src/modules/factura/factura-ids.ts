import { Types } from 'mongoose';

/**
 * Tolerance for ids stored in more than one representation (T7c).
 *
 * `@Prop({ type: Types.ObjectId, ref })` builds a `Mixed` path in this
 * project (e.g. `Producto.almacen`), and Mongoose never casts `Mixed` values:
 * a product created through `POST /producto` stores `almacen` as the raw hex
 * string the client sent (any case), while other writers store a real
 * ObjectId. A query value only matches the same BSON type, so every filter
 * factura runs against data it does not own lists all the forms.
 */

/**
 * The string forms an id may be stored in: lowercase and uppercase hex (a
 * mixed-case string stays unmatched). For a String path (`Producto.estado`),
 * where Mongoose would cast an ObjectId variant to the same lowercase hex.
 */
export function variantesHex(id: Types.ObjectId | string): [string, string] {
  const hex = new Types.ObjectId(id).toHexString();
  return [hex, hex.toUpperCase()];
}

/**
 * Every form an id may be stored in on a `Mixed` path: the ObjectId plus
 * `variantesHex`. Still correct on a real ObjectId path: Mongoose casts each
 * variant, so the list only gets duplicates.
 */
export function variantesId(
  id: Types.ObjectId | string,
): [Types.ObjectId, string, string] {
  const hexes = variantesHex(id);
  return [new Types.ObjectId(hexes[0]), ...hexes];
}

/**
 * Lowercase hex of an id stored as an ObjectId or as a string, or `null` when
 * absent, for comparisons in code.
 */
export function idCanonico(
  valor: Types.ObjectId | string | null | undefined,
): string | null {
  return valor === null || valor === undefined
    ? null
    : valor.toString().toLowerCase();
}

/** Whether two ids are the same, whatever their stored representation. */
export function mismoId(
  a: Types.ObjectId | string | null | undefined,
  b: Types.ObjectId | string | null | undefined,
): boolean {
  const canonicoA = idCanonico(a);
  return canonicoA !== null && canonicoA === idCanonico(b);
}
