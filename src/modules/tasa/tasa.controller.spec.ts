import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsuarioRol } from '../auth/schemas/usuarios.schema';
import { ROLES_ESCRIBIR_TASAS, TasaController } from './tasa.controller';

const GUARDS_METADATA_KEY = '__guards__';
const ROLES_METADATA_KEY = 'roles';

const proto = TasaController.prototype as unknown as Record<
  string,
  (...a: never[]) => unknown
>;

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => TasaController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

const guard = new RolesGuard(new Reflector());

describe('TasaController roles', () => {
  it('requires JWT and roles guards on the whole controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      TasaController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('restricts create, update and remove to administrador, gerente and economico', () => {
    for (const nombre of ['create', 'upsertByMoneda', 'update', 'remove']) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre])).toEqual(
        ROLES_ESCRIBIR_TASAS,
      );
      for (const rol of [
        UsuarioRol.CAJERO,
        UsuarioRol.FACTURADOR,
        UsuarioRol.EMPLEADO,
        UsuarioRol.JEFE,
      ]) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(false);
      }
      for (const rol of ROLES_ESCRIBIR_TASAS) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(true);
      }
    }
  });

  it('leaves read handlers without @Roles (any authenticated role)', () => {
    for (const nombre of ['findAll', 'findByMoneda', 'findOne']) {
      expect(
        Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre]),
      ).toBeUndefined();
      expect(
        guard.canActivate(contexto(UsuarioRol.FACTURADOR, proto[nombre])),
      ).toBe(true);
    }
  });
});
