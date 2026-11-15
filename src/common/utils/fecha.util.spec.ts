import { BadRequestException } from '@nestjs/common';
import { normalizarFecha, rangoDelDia } from './fecha.util';

describe('normalizarFecha / rangoDelDia', () => {
  it('keeps a valid AAAA-MM-DD date as is, including a leap day', () => {
    expect(normalizarFecha('2026-11-15')).toBe('2026-11-15');
    expect(normalizarFecha('2028-02-29')).toBe('2028-02-29');
  });

  it.each([
    '2026-13-45',
    '2026-02-30',
    '2027-02-29',
    '2026-00-10',
    '2026-04-31',
  ])('rejects %s: it has the format but is not a calendar date', (fecha) => {
    expect(() => normalizarFecha(fecha)).toThrow(BadRequestException);
    expect(() => rangoDelDia(fecha)).toThrow(BadRequestException);
  });

  it('still rejects text that is not a date', () => {
    expect(() => normalizarFecha('zzz')).toThrow(BadRequestException);
  });
});
