import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import {
  UsuarioRol,
  ModuloApp,
  TODOS_LOS_MODULOS,
} from './schemas/usuarios.schema';

describe('AuthService', () => {
  const hash = bcrypt.hashSync('secreto1', 4);

  const consulta = <T>(resultado: T) => {
    const q: Record<string, jest.Mock> = {};
    q.collation = jest.fn().mockReturnValue(q);
    q.select = jest.fn().mockReturnValue(q);
    q.exec = jest.fn().mockResolvedValue(resultado);
    return q;
  };

  const crearServicio = (usuario: unknown) => {
    const findOne = jest.fn().mockReturnValue(consulta(usuario));
    const findById = jest.fn().mockReturnValue(consulta(usuario));
    const model = { findOne, findById } as never;
    const jwt = new JwtService({ secret: 'test' });
    return { service: new AuthService(model, jwt), findOne, jwt };
  };

  const usuarioBase = (extra: Record<string, unknown> = {}) => ({
    _id: 'u1',
    nombre: 'maria',
    contraseña: hash,
    rol: UsuarioRol.CAJERO,
    modulos: [ModuloApp.PUNTO_VENTA],
    set: jest.fn(),
    ...extra,
  });

  it('valida credenciales correctas', async () => {
    const { service, findOne } = crearServicio(usuarioBase());
    const u = await service.validateUser(' maria ', 'secreto1');
    expect(u).not.toBeNull();
    expect(findOne).toHaveBeenCalledWith({ nombre: 'maria' });
  });

  it('rechaza contraseña incorrecta', async () => {
    const { service } = crearServicio(usuarioBase());
    expect(await service.validateUser('maria', 'otra')).toBeNull();
  });

  it('rechaza usuario inexistente', async () => {
    const { service } = crearServicio(null);
    expect(await service.validateUser('nadie', 'secreto1')).toBeNull();
  });

  it('login devuelve token y los módulos del usuario', () => {
    const { service, jwt } = crearServicio(null);
    const r = service.login(usuarioBase());
    expect(r.usuario).toEqual({
      id: 'u1',
      nombre: 'maria',
      rol: UsuarioRol.CAJERO,
      modulos: [ModuloApp.PUNTO_VENTA],
    });
    const payload = jwt.decode(r.access_token) as Record<string, unknown>;
    expect(payload.sub).toBe('u1');
    expect(payload.rol).toBe(UsuarioRol.CAJERO);
    expect(payload).not.toHaveProperty('contraseña');
  });

  it('el administrador siempre recibe todos los módulos', () => {
    const { service } = crearServicio(null);
    const r = service.login(
      usuarioBase({ rol: UsuarioRol.ADMIN, modulos: [] }),
    );
    expect(r.usuario.modulos).toEqual(TODOS_LOS_MODULOS);
  });
});
