import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { ArqueoCajaController } from './arqueo-caja.controller';

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => ArqueoCajaController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

/* eslint-disable @typescript-eslint/unbound-method */
const proto = ArqueoCajaController.prototype;
/* eslint-enable @typescript-eslint/unbound-method */

describe('ArqueoCajaController', () => {
  it('exige JWT y roles, con @Roles en el controlador', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      ArqueoCajaController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata('roles', ArqueoCajaController)).toEqual([
      UsuarioRol.ADMIN,
      UsuarioRol.ECONOMICO,
      UsuarioRol.GERENTE,
    ]);
  });

  it('administrador, económico y gerente pueden arquear; cajero y facturador reciben 403', () => {
    const guard = new RolesGuard(new Reflector());
    for (const h of [
      proto.crear,
      proto.listar,
      proto.findOne,
      proto.esperado,
    ]) {
      for (const rol of [
        UsuarioRol.ADMIN,
        UsuarioRol.ECONOMICO,
        UsuarioRol.GERENTE,
      ])
        expect(guard.canActivate(contexto(rol, h))).toBe(true);
      for (const rol of [
        UsuarioRol.CAJERO,
        UsuarioRol.FACTURADOR,
        UsuarioRol.EMPLEADO,
      ])
        expect(guard.canActivate(contexto(rol, h))).toBe(false);
    }
  });
});
