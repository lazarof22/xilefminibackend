import { UnauthorizedException } from '@nestjs/common';
import { LocalStrategy } from './local.strategies';
import { JwtStrategy, extraerBearerEstricto } from './jwt.strategies';
import type { AuthService } from '../auth.service';

describe('LocalStrategy.validate — input that is not text', () => {
  const validateUser = jest.fn();
  const estrategia = new LocalStrategy({
    validateUser,
  } as unknown as AuthService);

  beforeEach(() => validateUser.mockReset());

  it.each([123, true, { $ne: null }, ['admin'], null, undefined])(
    'a non-string nombre (%p) is a 401 and never reaches the service',
    async (valor) => {
      await expect(
        estrategia.validate(valor as unknown as string, 'x'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(validateUser).not.toHaveBeenCalled();
    },
  );

  it.each([123, true, { $ne: null }, ['x'], null])(
    'a non-string contraseña (%p) is a 401 and never reaches bcrypt',
    async (valor) => {
      await expect(
        estrategia.validate('admin', valor as unknown as string),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(validateUser).not.toHaveBeenCalled();
    },
  );

  it('text credentials still go to the service', async () => {
    validateUser.mockResolvedValue({ _id: 'u1' });
    await expect(estrategia.validate('admin', 'clave')).resolves.toEqual({
      _id: 'u1',
    });
  });
});

describe('JwtStrategy.validate — sub', () => {
  const findById = jest.fn();
  const modelo = {
    findById: (id: unknown) => ({
      lean: () => ({ exec: () => findById(id) }),
    }),
  };
  const estrategia = new JwtStrategy(modelo as never);
  const ID = '64b000000000000000000010';

  beforeEach(() => findById.mockReset());

  it.each([{ $ne: null }, [ID], 42, 'no-es-un-id', null, undefined])(
    'a sub of %p is a 401 and is never queried',
    async (sub) => {
      await expect(
        estrategia.validate({ sub: sub as unknown as string }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(findById).not.toHaveBeenCalled();
    },
  );

  it('a valid sub loads the user from the database', async () => {
    findById.mockResolvedValue({
      _id: ID,
      nombre: 'ana',
      rol: 'cajero',
      modulos: [],
    });
    await expect(estrategia.validate({ sub: ID })).resolves.toMatchObject({
      userId: ID,
      rol: 'cajero',
    });
  });
});

describe('extraerBearerEstricto', () => {
  const T = 'aaa.bbb.ccc';
  const con = (authorization: unknown) => ({ headers: { authorization } });

  it('accepts exactly "Bearer <jwt>"', () => {
    expect(extraerBearerEstricto(con(`Bearer ${T}`))).toBe(T);
  });

  it.each([
    `bearer ${T}`,
    `BEARER ${T}`,
    `Bearer  ${T}`,
    `Bearer\t${T}`,
    ` Bearer ${T}`,
    `Bearer ${T} `,
    `Bearer ${T} otro`,
    `Bearer ${T}\n`,
    `Basic ${T}`,
    T,
    'Bearer ',
    'Bearer x',
    'Bearer a.b',
    '',
  ])('rejects %p', (cabecera) => {
    expect(extraerBearerEstricto(con(cabecera))).toBeNull();
  });

  it('rejects a missing or non-string header', () => {
    expect(extraerBearerEstricto({})).toBeNull();
    expect(extraerBearerEstricto(con(undefined))).toBeNull();
    expect(extraerBearerEstricto(con(['Bearer a.b.c']))).toBeNull();
  });
});
