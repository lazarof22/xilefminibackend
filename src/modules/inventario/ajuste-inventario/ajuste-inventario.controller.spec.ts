/* eslint-disable @typescript-eslint/unbound-method */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { AjusteInventarioController } from './ajuste-inventario.controller';

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => AjusteInventarioController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

const proto = AjusteInventarioController.prototype;

describe('AjusteInventarioController', () => {
  it('exige JWT y roles, con @Roles en el controlador', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      AjusteInventarioController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata('roles', AjusteInventarioController)).toEqual([
      UsuarioRol.ADMIN,
      UsuarioRol.ECONOMICO,
    ]);
  });

  it('administrador y económico sí; gerente, cajero y facturador reciben 403', () => {
    const guard = new RolesGuard(new Reflector());
    for (const h of [proto.crear, proto.findAll, proto.findOne]) {
      for (const rol of [UsuarioRol.ADMIN, UsuarioRol.ECONOMICO]) {
        expect(guard.canActivate(contexto(rol, h))).toBe(true);
      }
      for (const rol of [
        UsuarioRol.GERENTE,
        UsuarioRol.CAJERO,
        UsuarioRol.FACTURADOR,
        UsuarioRol.EMPLEADO,
      ]) {
        expect(guard.canActivate(contexto(rol, h))).toBe(false);
      }
    }
  });
});
