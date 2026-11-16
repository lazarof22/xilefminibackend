import {
  PROFUNDIDAD_MAXIMA_JSON,
  manejarErrorDeCuerpo,
  verificarProfundidadJson,
} from './json-body';

const buf = (s: string) => Buffer.from(s);
const verificar = (s: string) => verificarProfundidadJson({}, {}, buf(s));

describe('verificarProfundidadJson', () => {
  it('accepts ordinary bodies, including the maximum depth', () => {
    expect(() => verificar('{"a":[{"b":1}],"c":"x"}')).not.toThrow();
    const justo =
      '['.repeat(PROFUNDIDAD_MAXIMA_JSON) + ']'.repeat(PROFUNDIDAD_MAXIMA_JSON);
    expect(() => verificar(justo)).not.toThrow();
  });

  it('refuses a body nested deeper than the maximum with a 400', () => {
    const hondo = '['.repeat(PROFUNDIDAD_MAXIMA_JSON + 1);

    expect(() => verificar(hondo)).toThrow(
      expect.objectContaining({ status: 400, type: 'entity.too.deep' }),
    );
  });

  it('refuses thousands of nested arrays quickly (the stack overflow case)', () => {
    expect(() => verificar('{"version_firma":' + '['.repeat(5000))).toThrow(
      expect.objectContaining({ type: 'entity.too.deep' }),
    );
  });

  it('ignores brackets inside strings, including escaped quotes', () => {
    const entreComillas = '"' + '['.repeat(500) + '"';
    expect(() => verificar(`{"a":${entreComillas}}`)).not.toThrow();
    expect(() => verificar(`{"a":"\\"${'['.repeat(500)}\\""}`)).not.toThrow();
  });
});

describe('manejarErrorDeCuerpo', () => {
  function respuesta() {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  it.each([
    ['entity.parse.failed', 400, /no es un JSON válido/],
    ['entity.too.deep', 400, /demasiado anidado/],
    ['entity.too.large', 413, /demasiado grande/],
  ])('answers %s as JSON with status %i', (tipo, status, mensaje) => {
    const res = respuesta();
    const next = jest.fn();

    manejarErrorDeCuerpo({ type: tipo }, {} as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: status,
        message: expect.stringMatching(mensaje),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('passes any other error on untouched', () => {
    const next = jest.fn();
    const err = new Error('otro');

    manejarErrorDeCuerpo(err, {} as never, respuesta() as never, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
