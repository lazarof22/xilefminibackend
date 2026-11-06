import { EstadoTurnoCaja, TurnoCajaSchema } from './turno-caja.schema';

describe('TurnoCajaSchema indexes', () => {
  const indices = TurnoCajaSchema.indexes();

  it('has one partial unique index so a cashier can have only one open turno', () => {
    const unicos = indices.filter(([, opciones]) => opciones?.unique === true);
    expect(unicos).toHaveLength(1);
    const [campos, opciones] = unicos[0];
    expect(campos).toEqual({ cajeroId: 1 });
    expect(opciones?.partialFilterExpression).toEqual({
      estado: EstadoTurnoCaja.ABIERTO,
    });
    // A distinct name lets it coexist with a plain cajeroId_1 index already in an existing database.
    expect(opciones?.name).toBe('cajeroId_turno_abierto_unico');
  });

  it('does not declare cajeroId twice with the same key pattern (Mongo would drop the unique one)', () => {
    const mismoPatron = indices.filter(
      ([campos]) => JSON.stringify(campos) === JSON.stringify({ cajeroId: 1 }),
    );
    expect(mismoPatron).toHaveLength(1);
  });
});
