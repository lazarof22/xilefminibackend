/* eslint-disable @typescript-eslint/unbound-method */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { RecepcionController } from './recepcion.controller';

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => RecepcionController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

const proto = RecepcionController.prototype;

describe('RecepcionController', () => {
  const guard = new RolesGuard(new Reflector());

  it('exige JWT y roles', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      RecepcionController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('crear, editar y registrar: administrador, gerente y económico sí; cajero y facturador reciben 403', () => {
    for (const h of [proto.crear, proto.actualizar, proto.registrar]) {
      expect(Reflect.getMetadata('roles', h)).toEqual([
        UsuarioRol.ADMIN,
        UsuarioRol.GERENTE,
        UsuarioRol.ECONOMICO,
      ]);
      for (const rol of [
        UsuarioRol.ADMIN,
        UsuarioRol.GERENTE,
        UsuarioRol.ECONOMICO,
      ]) {
        expect(guard.canActivate(contexto(rol, h))).toBe(true);
      }
      for (const rol of [
        UsuarioRol.CAJERO,
        UsuarioRol.FACTURADOR,
        UsuarioRol.EMPLEADO,
      ]) {
        expect(guard.canActivate(contexto(rol, h))).toBe(false);
      }
    }
  });

  it('la consulta queda abierta a cualquier usuario autenticado', () => {
    for (const h of [proto.findAll, proto.findOne]) {
      expect(Reflect.getMetadata('roles', h)).toBeUndefined();
      expect(guard.canActivate(contexto(UsuarioRol.CAJERO, h))).toBe(true);
    }
  });
});
