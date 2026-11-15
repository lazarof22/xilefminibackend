import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { KardexController, ROLES_ESCRIBIR_KARDEX } from './kardex.controller';

const GUARDS_METADATA_KEY = '__guards__';
const ROLES_METADATA_KEY = 'roles';

const proto = KardexController.prototype as unknown as Record<
  string,
  (...a: never[]) => unknown
>;

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => KardexController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

const guard = new RolesGuard(new Reflector());

describe('KardexController roles', () => {
  it('requires JWT and roles guards on the whole controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      KardexController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('restricts create, update and remove to administrador and economico', () => {
    for (const nombre of ['create', 'update', 'remove']) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre])).toEqual(
        ROLES_ESCRIBIR_KARDEX,
      );
    }
    for (const nombre of ['create', 'update', 'remove']) {
      for (const rol of [
        UsuarioRol.CAJERO,
        UsuarioRol.FACTURADOR,
        UsuarioRol.GERENTE,
        UsuarioRol.EMPLEADO,
      ]) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(false);
      }
      for (const rol of ROLES_ESCRIBIR_KARDEX) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(true);
      }
    }
  });

  it('declares exactly administrador and economico', () => {
    expect([...ROLES_ESCRIBIR_KARDEX].sort()).toEqual(
      [UsuarioRol.ADMIN, UsuarioRol.ECONOMICO].sort(),
    );
  });

  it('leaves read handlers without @Roles (any authenticated role)', () => {
    for (const nombre of ['findAll', 'findAllSalidas', 'findOne']) {
      expect(
        Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre]),
      ).toBeUndefined();
      expect(
        guard.canActivate(contexto(UsuarioRol.FACTURADOR, proto[nombre])),
      ).toBe(true);
    }
  });
});
