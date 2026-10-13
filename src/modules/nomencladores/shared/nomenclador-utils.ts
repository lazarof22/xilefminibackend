// Pone en mayúscula la primera letra de cada palabra. No usa \b\w porque en JS
// \w no incluye letras acentuadas ni la ñ ("españa" quedaba como "EspañA").
export function normalizeName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map(
      (palabra) => palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1),
    )
    .join(' ');
}
