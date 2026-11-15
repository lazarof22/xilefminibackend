import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { PagoController, ROLES_ESCRIBIR_PAGOS } from './pago.controller';

const GUARDS_METADATA_KEY = '__guards__';
const ROLES_METADATA_KEY = 'roles';

const proto = PagoController.prototype as unknown as Record<
  string,
  (...a: never[]) => unknown
>;

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => PagoController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

const guard = new RolesGuard(new Reflector());

describe('PagoController roles', () => {
  it('requires JWT and roles guards on the whole controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      PagoController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('restricts every payment write to administrador and gerente', () => {
    for (const nombre of ['createPagoE', 'createPagoT', 'createPagoC']) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, proto[nombre])).toEqual(
        ROLES_ESCRIBIR_PAGOS,
      );
    }
    for (const nombre of ['createPagoE', 'createPagoT', 'createPagoC']) {
      for (const rol of [
        UsuarioRol.CAJERO,
        UsuarioRol.FACTURADOR,
        UsuarioRol.EMPLEADO,
        UsuarioRol.JEFE,
      ]) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(false);
      }
      for (const rol of ROLES_ESCRIBIR_PAGOS) {
        expect(guard.canActivate(contexto(rol, proto[nombre]))).toBe(true);
      }
    }
  });

  it('declares exactly administrador and gerente', () => {
    expect([...ROLES_ESCRIBIR_PAGOS].sort()).toEqual(
      [UsuarioRol.ADMIN, UsuarioRol.GERENTE].sort(),
    );
  });

  it('leaves read handlers without @Roles (any authenticated role)', () => {
    for (const nombre of [
      'findAll',
      'resumenEfectivoEstandar',
      'resumenPorDescuento',
      'resumenPorTransferencia',
      'resumenCuentaCasa',
      'resumenPorCredito',
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
