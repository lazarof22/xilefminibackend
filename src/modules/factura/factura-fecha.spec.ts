import { obtenerFechaEnZona } from './factura-fecha';

describe('obtenerFechaEnZona (T4)', () => {
  afterEach(() => jest.useRealTimers());

  it('returns YYYY-MM-DD in America/Havana, crossing the UTC day boundary', () => {
    // Havana is UTC-4 in September (no DST): 2026-09-23T02:00:00Z is
    // 2026-09-22T22:00:00 local time.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T02:00:00Z'));

    expect(obtenerFechaEnZona('America/Havana')).toBe('2026-09-22');
  });

  it('does not cross the boundary before local midnight', () => {
    // 2026-09-22T23:30:00Z is 2026-09-22T19:30:00 local time.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-22T23:30:00Z'));

    expect(obtenerFechaEnZona('America/Havana')).toBe('2026-09-22');
  });

  it('accepts an explicit date instead of the system clock', () => {
    expect(
      obtenerFechaEnZona('America/Havana', new Date('2026-01-01T03:00:00Z')),
    ).toBe('2025-12-31');
  });
});
