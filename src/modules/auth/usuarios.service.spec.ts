import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { LicenciaService } from '../licencia/licencia.service';
import { UsuariosService } from './usuarios.service';
import { ModuloApp, UsuarioRol } from './schemas/usuarios.schema';

const ID = '507f1f77bcf86cd799439011';
const OTRO = '507f1f77bcf86cd799439012';

function consulta<T>(resultado: T) {
  const q: Record<string, jest.Mock> = {};
  for (const m of ['collation', 'select', 'sort', 'lean'])
    q[m] = jest.fn().mockReturnValue(q);
  q.exec = jest.fn().mockResolvedValue(resultado);
  return q;
}

describe('UsuariosService', () => {
  let model: Record<string, jest.Mock>;
  let licencia: { crearUsuarioConCupo: jest.Mock };
  let service: UsuariosService;

  beforeEach(() => {
    model = {
      find: jest.fn(),
      findOne: jest.fn().mockReturnValue(consulta(null)),
      findById: jest.fn(),
      countDocuments: jest.fn().mockReturnValue(consulta(0)),
      create: jest.fn(),
      deleteOne: jest.fn().mockReturnValue(consulta({})),
    };
    // Ejecuta `crear` directamente (sin tope de licencia).
    licencia = {
      crearUsuarioConCupo: jest.fn(
        (_e: unknown, ops: { crear: () => unknown }) => ops.crear(),
      ),
    };
    service = new UsuariosService(
      model as never,
      licencia as unknown as LicenciaService,
    );
  });

  const usuarioDoc = (extra: Record<string, unknown> = {}) => ({
    _id: ID,
    nombre: 'ana',
    rol: UsuarioRol.CAJERO,
    modulos: [ModuloApp.VENTAS],
    contraseña: 'hash-viejo',
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  });

  it('crea el usuario con la contraseña cifrada y respeta el tope de licencia', async () => {
    model.create.mockImplementation((d: Record<string, unknown>) =>
      Promise.resolve({ _id: ID, ...d }),
    );
    const r = await service.create({
      nombre: 'ana',
      contraseña: 'secreto1',
      rol: UsuarioRol.CAJERO,
      modulos: [ModuloApp.VENTAS],
    });
    expect(licencia.crearUsuarioConCupo).toHaveBeenCalledTimes(1);
    const [[guardado]] = model.create.mock.calls as [[{ contraseña: string }]];
    expect(guardado.contraseña).not.toBe('secreto1');
    expect(await bcrypt.compare('secreto1', guardado.contraseña)).toBe(true);
    expect(r).toMatchObject({ nombre: 'ana', modulos: [ModuloApp.VENTAS] });
    expect(r).not.toHaveProperty('contraseña');
  });

  it('rechaza un nombre repetido', async () => {
    model.findOne.mockReturnValue(consulta({ _id: OTRO }));
    await expect(
      service.create({
        nombre: 'ana',
        contraseña: 'secreto1',
        rol: UsuarioRol.CAJERO,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(licencia.crearUsuarioConCupo).not.toHaveBeenCalled();
  });

  it('el administrador lista todos los módulos aunque no se hayan marcado', async () => {
    model.create.mockImplementation((d: Record<string, unknown>) =>
      Promise.resolve({ _id: ID, ...d }),
    );
    const r = await service.create({
      nombre: 'jefe',
      contraseña: 'secreto1',
      rol: UsuarioRol.ADMIN,
    });
    expect(r.modulos).toHaveLength(Object.values(ModuloApp).length);
  });

  it('actualiza rol y módulos, y solo cambia la contraseña si se envía', async () => {
    const doc = usuarioDoc();
    model.findById.mockReturnValue(consulta(doc));
    await service.update(ID, {
      rol: UsuarioRol.GERENTE,
      modulos: [ModuloApp.COMPRAS],
    });
    expect(doc).toMatchObject({
      rol: UsuarioRol.GERENTE,
      modulos: [ModuloApp.COMPRAS],
      contraseña: 'hash-viejo',
    });

    await service.update(ID, { contraseña: 'nueva-clave' });
    expect(doc.contraseña).not.toBe('hash-viejo');
    expect(await bcrypt.compare('nueva-clave', doc.contraseña)).toBe(true);
  });

  it('no deja degradar al último administrador', async () => {
    model.findById.mockReturnValue(
      consulta(usuarioDoc({ rol: UsuarioRol.ADMIN })),
    );
    model.countDocuments.mockReturnValue(consulta(0));
    await expect(
      service.update(ID, { rol: UsuarioRol.CAJERO }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no permite eliminarse a sí mismo ni al último administrador', async () => {
    model.findById.mockReturnValue(
      consulta(usuarioDoc({ rol: UsuarioRol.ADMIN })),
    );
    await expect(service.remove(ID, ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    model.countDocuments.mockReturnValue(consulta(0));
    await expect(service.remove(ID, OTRO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('elimina a otro usuario y devuelve 404 si no existe', async () => {
    model.findById.mockReturnValue(consulta(usuarioDoc()));
    expect(await service.remove(ID, OTRO)).toEqual({ deleted: true });
    await expect(service.remove('no-es-id', OTRO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
