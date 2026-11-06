import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import {
  DepositoBancarioController,
  ROLES_REGISTRAR_DEPOSITO,
} from './deposito-bancario.controller';

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => DepositoBancarioController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

/* eslint-disable @typescript-eslint/unbound-method */
const proto = DepositoBancarioController.prototype;
/* eslint-enable @typescript-eslint/unbound-method */

describe('DepositoBancarioController', () => {
  it('exige JWT y roles', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      DepositoBancarioController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('PUT /configuracion es solo del administrador (403 para el resto)', () => {
    expect(Reflect.getMetadata('roles', proto.actualizarConfiguracion)).toEqual(
      [UsuarioRol.ADMIN],
    );
    const guard = new RolesGuard(new Reflector());
    for (const rol of [
      UsuarioRol.GERENTE,
      UsuarioRol.ECONOMICO,
      UsuarioRol.CAJERO,
    ])
      expect(
        guard.canActivate(contexto(rol, proto.actualizarConfiguracion)),
      ).toBe(false);
    expect(
      guard.canActivate(
        contexto(UsuarioRol.ADMIN, proto.actualizarConfiguracion),
      ),
    ).toBe(true);
  });

  it('alertas y configuración son lecturas abiertas; listar y consultar un depósito exigen rol', () => {
    for (const h of [proto.alertas, proto.configuracion])
      expect(Reflect.getMetadata('roles', h)).toBeUndefined();
    for (const h of [proto.listar, proto.findOne])
      expect(Reflect.getMetadata('roles', h)).toEqual(ROLES_REGISTRAR_DEPOSITO);
    const guard = new RolesGuard(new Reflector());
    expect(
      guard.canActivate(contexto(UsuarioRol.FACTURADOR, proto.listar)),
    ).toBe(false);
    expect(
      guard.canActivate(contexto(UsuarioRol.ECONOMICO, proto.findOne)),
    ).toBe(true);
  });
});
