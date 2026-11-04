import { diasCorridosEntre, sumarDiasHabiles } from './plazo-deposito.util';

const f = (s: string) => new Date(`${s}T10:00:00`);

describe('sumarDiasHabiles', () => {
  it('lunes + 1 día hábil = martes', () => {
    expect(sumarDiasHabiles(f('2026-11-02'), 1).getDate()).toBe(3);
  });

  it('viernes + 1 día hábil = lunes (salta el fin de semana)', () => {
    const r = sumarDiasHabiles(f('2026-11-06'), 1);
    expect(r.getDay()).toBe(1);
    expect(r.getDate()).toBe(9);
  });

  it('sábado + 1 día hábil = lunes', () => {
    expect(sumarDiasHabiles(f('2026-11-07'), 1).getDate()).toBe(9);
  });

  it('0 días devuelve la misma fecha y no muta la entrada', () => {
    const base = f('2026-11-06');
    const copia = base.getTime();
    expect(sumarDiasHabiles(base, 0).getTime()).toBe(copia);
    sumarDiasHabiles(base, 3);
    expect(base.getTime()).toBe(copia);
  });
});

describe('diasCorridosEntre', () => {
  it('cuenta días de calendario completos', () => {
    expect(diasCorridosEntre(f('2026-11-01'), f('2026-11-06'))).toBe(5);
    expect(diasCorridosEntre(f('2026-11-06'), f('2026-11-06'))).toBe(0);
  });
});
