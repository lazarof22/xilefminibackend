import { createHash } from 'crypto';

/**
 * JSON con las claves ordenadas: el mismo contenido da siempre el mismo texto,
 * da igual el orden en que llegaron las propiedades. Se omiten los
 * `undefined`; fechas y ObjectId se escriben como texto.
 */
export function canonico(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null) return 'null';

  if (valor instanceof Date) return JSON.stringify(valor.toISOString());

  if (Array.isArray(valor)) {
    return `[${valor.map((v) => canonico(v)).join(',')}]`;
  }

  if (typeof valor === 'object') {
    // ObjectId y similares saben escribirse como texto.
    const aTexto = (valor as { toHexString?: () => string }).toHexString;
    if (typeof aTexto === 'function') {
      return JSON.stringify(aTexto.call(valor));
    }

    const objeto = valor as Record<string, unknown>;
    const campos = Object.keys(objeto)
      .filter((clave) => objeto[clave] !== undefined)
      .sort()
      .map((clave) => `${JSON.stringify(clave)}:${canonico(objeto[clave])}`);
    return `{${campos.join(',')}}`;
  }

  return JSON.stringify(valor);
}

/** Huella SHA-256 (hex) del contenido canónico. */
export function huellaDe(valor: unknown): string {
  return createHash('sha256').update(canonico(valor)).digest('hex');
}
