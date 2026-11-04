const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * Suma `n` días hábiles (lunes a viernes) a una fecha. No modela feriados: la
 * norma del BCC se confirma aparte (ver README), por eso el cálculo es simple
 * y está aislado en esta función.
 */
export function sumarDiasHabiles(fecha: Date, n: number): Date {
  const r = new Date(fecha.getTime());
  let restantes = n;
  while (restantes > 0) {
    r.setDate(r.getDate() + 1);
    const dia = r.getDay();
    if (dia !== 0 && dia !== 6) restantes -= 1;
  }
  return r;
}

/** Días de calendario completos entre dos fechas (a -> b). */
export function diasCorridosEntre(a: Date, b: Date): number {
  const inicio = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const fin = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((fin - inicio) / MS_DIA);
}
