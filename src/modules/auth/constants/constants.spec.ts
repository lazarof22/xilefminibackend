import { obtenerJwtSecret } from './constants';

describe('obtenerJwtSecret', () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it('devuelve la clave configurada', () => {
    process.env.JWT_SECRET = '  clave-larga-y-aleatoria  ';
    expect(obtenerJwtSecret()).toBe('clave-larga-y-aleatoria');
  });

  it.each([undefined, '', '   ', 'Chimuelo'])(
    'no arranca con una clave ausente o conocida (%p)',
    (valor) => {
      if (valor === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = valor;
      expect(() => obtenerJwtSecret()).toThrow('JWT_SECRET no está configurado');
    },
  );
});
