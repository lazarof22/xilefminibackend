import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import {
  CuadreCajaController,
  ROLES_CREAR_CUADRE,
  ROLES_MODIFICAR_CUADRE,
} from './cuadre_caja.controller';

const GUARDS_METADATA_KEY = '__guards__';
const ROLES_METADATA_KEY = 'roles';

const proto = CuadreCajaController.prototype as unknown as Record<
  string,
  (...a: never[]) => unknown
>;

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => CuadreCajaController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

const guard = new RolesGuard(new Reflector());

describe('CuadreCajaController roles', () => {
  it('requires JWT and roles guards on the whole controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      CuadreCajaController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('lets the cashier create a cuadre but not other roles', () => {
    for (const nombre of ['create']) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre])).toEqual(
        ROLES_CREAR_CUADRE,
      );
    }
    for (const nombre of ['create']) {
      for (const rol of [
        UsuarioRol.FACTURADOR,
        UsuarioRol.EMPLEADO,
        UsuarioRol.JEFE,
      ]) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(false);
      }
      for (const rol of ROLES_CREAR_CUADRE) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(true);
      }
    }
  });

  it('declares the create roles', () => {
    expect([...ROLES_CREAR_CUADRE].sort()).toEqual(
      [
        UsuarioRol.CAJERO,
        UsuarioRol.ADMIN,
        UsuarioRol.GERENTE,
        UsuarioRol.ECONOMICO,
      ].sort(),
    );
  });

  it('keeps update and remove away from the cashier', () => {
    for (const nombre of ['update', 'remove']) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre])).toEqual(
        ROLES_MODIFICAR_CUADRE,
      );
    }
    for (const nombre of ['update', 'remove']) {
      for (const rol of [
        UsuarioRol.CAJERO,
        UsuarioRol.FACTURADOR,
        UsuarioRol.EMPLEADO,
        UsuarioRol.JEFE,
      ]) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(false);
      }
      for (const rol of ROLES_MODIFICAR_CUADRE) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(true);
      }
    }
  });

  it('declares administrador, economico and gerente for update and remove', () => {
    expect([...ROLES_MODIFICAR_CUADRE].sort()).toEqual(
      [UsuarioRol.ADMIN, UsuarioRol.ECONOMICO, UsuarioRol.GERENTE].sort(),
    );
  });

  it('leaves read handlers without @Roles (any authenticated role)', () => {
    for (const nombre of [
      'findAll',
      'getResumenDiario',
      'getTotalDia',
      'findOne',
    ]) {
      expect(
        Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre]),
      ).toBeUndefined();
      expect(
        guard.canActivate(contexto(UsuarioRol.FACTURADOR, proto[nombre])),
      ).toBe(true);
    }
  });
});
