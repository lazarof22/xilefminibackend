/**
 * Prefijos de tarjeta de un banco.
 *
 * No hay una fuente oficial verificada de qué dígitos identifican a cada banco
 * en el número de una tarjeta, así que NO se fijan en el código: cada banco
 * lleva su lista de patrones en el nomenclador y la validación solo avisa
 * (nunca bloquea el cobro).
 *
 * Un patrón son dígitos y `?` (cualquier dígito) y se compara con el INICIO del
 * número de la tarjeta. Así se puede expresar tanto un prefijo corrido
 * (`92250699`) como una regla sobre el segundo grupo de 4 dígitos
 * (`????0699`: el segundo grupo es 0699, el primero no importa).
 */

/** De 1 a 19 caracteres: dígitos o `?`. */
export const PATRON_PREFIJO = /^[0-9?]{1,19}$/;

/** Deja solo los dígitos (quita espacios, guiones y cualquier separador). */
export const soloDigitos = (numero: string): string =>
  String(numero ?? '').replace(/\D/g, '');

/** Quita espacios y guiones de un patrón escrito como `9225 0699` o `????-0699`. */
export const normalizarPatron = (patron: string): string =>
  String(patron ?? '').replace(/[\s-]/g, '');

/** ¿El inicio del número (solo dígitos) cumple el patrón? */
export function coincidePrefijo(digitos: string, patron: string): boolean {
  if (!PATRON_PREFIJO.test(patron) || patron.length > digitos.length) {
    return false;
  }

  for (let i = 0; i < patron.length; i++) {
    if (patron[i] !== '?' && patron[i] !== digitos[i]) return false;
  }

  return true;
}

export const coincideConAlguno = (
  digitos: string,
  patrones: readonly string[],
): boolean => patrones.some((patron) => coincidePrefijo(digitos, patron));
