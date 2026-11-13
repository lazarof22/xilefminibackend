import {
  coincideConAlguno,
  coincidePrefijo,
  normalizarPatron,
  PATRON_PREFIJO,
  soloDigitos,
} from './prefijo-tarjeta';

describe('prefijo de tarjeta', () => {
  it('soloDigitos quita espacios, guiones y cualquier separador', () => {
    expect(soloDigitos('9225 0699-1234.5678')).toBe('9225069912345678');
    expect(soloDigitos('')).toBe('');
    expect(soloDigitos(undefined as unknown as string)).toBe('');
  });

  it('normalizarPatron quita espacios y guiones', () => {
    expect(normalizarPatron('9225 0699')).toBe('92250699');
    expect(normalizarPatron('????-0699')).toBe('????0699');
  });

  describe('coincidePrefijo', () => {
    const tarjeta = '9225069912345678';

    it('un prefijo corrido se compara con el inicio del número', () => {
      expect(coincidePrefijo(tarjeta, '9225')).toBe(true);
      expect(coincidePrefijo(tarjeta, '92250699')).toBe(true);
      expect(coincidePrefijo(tarjeta, '9226')).toBe(false);
      // Con el patrón en el medio del número no cuenta.
      expect(coincidePrefijo(tarjeta, '0699')).toBe(false);
    });

    it('? vale cualquier dígito: sirve para la regla del segundo grupo de 4 dígitos', () => {
      expect(coincidePrefijo(tarjeta, '????0699')).toBe(true);
      expect(coincidePrefijo('1111069922223333', '????0699')).toBe(true);
      expect(coincidePrefijo('9225059822223333', '????0699')).toBe(false);
    });

    it('un patrón más largo que el número no coincide', () => {
      expect(coincidePrefijo('9225', '92250699')).toBe(false);
      expect(coincidePrefijo('', '9')).toBe(false);
    });

    it('un patrón mal formado nunca coincide', () => {
      for (const patron of ['', 'ab', '92 25', '9225*', '9'.repeat(20)]) {
        expect(coincidePrefijo(tarjeta, patron)).toBe(false);
      }
    });
  });

  it('coincideConAlguno: basta con que cumpla uno de los patrones', () => {
    expect(coincideConAlguno('9227111122223333', ['9225', '9227'])).toBe(true);
    expect(coincideConAlguno('9228111122223333', ['9225', '9227'])).toBe(false);
    expect(coincideConAlguno('9228111122223333', [])).toBe(false);
  });

  it('PATRON_PREFIJO acepta de 1 a 19 dígitos o ?', () => {
    expect(PATRON_PREFIJO.test('????0699')).toBe(true);
    expect(PATRON_PREFIJO.test('9'.repeat(19))).toBe(true);
    expect(PATRON_PREFIJO.test('9'.repeat(20))).toBe(false);
    expect(PATRON_PREFIJO.test('')).toBe(false);
    expect(PATRON_PREFIJO.test('92 25')).toBe(false);
  });
});
