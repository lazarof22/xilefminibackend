import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { FichasNormativasController } from './fichas-normativas.controller';
import { FichasNormativasService } from './fichas-normativas.service';

const GUARDS_METADATA_KEY = '__guards__';
const ROLES_METADATA_KEY = 'roles';

/* eslint-disable @typescript-eslint/unbound-method */
const proto = FichasNormativasController.prototype;
/* eslint-enable @typescript-eslint/unbound-method */

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => FichasNormativasController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

describe('FichasNormativasController', () => {
  let controller: FichasNormativasController;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FichasNormativasController],
      providers: [FichasNormativasService],
    }).compile();
    controller = mod.get(FichasNormativasController);
  });

  it('requires JWT and roles on the whole controller', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      FichasNormativasController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('is readable by administrador, gerente and economico only', () => {
    const guard = new RolesGuard(new Reflector());
    for (const h of [proto.listar, proto.obtener]) {
      for (const rol of [
        UsuarioRol.ADMIN,
        UsuarioRol.GERENTE,
        UsuarioRol.ECONOMICO,
      ]) {
        expect(guard.canActivate(contexto(rol, h))).toBe(true);
      }
      for (const rol of [UsuarioRol.CAJERO, UsuarioRol.FACTURADOR]) {
        expect(guard.canActivate(contexto(rol, h))).toBe(false);
      }
    }
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, FichasNormativasController),
    ).toEqual([UsuarioRol.ADMIN, UsuarioRol.GERENTE, UsuarioRol.ECONOMICO]);
  });

  it('GET list returns the six sheets', () => {
    expect(controller.listar()).toHaveLength(6);
  });

  it('GET :codigo returns the sheet', () => {
    expect(controller.obtener('SC-3-06').nombre).toBe('Arqueo de Caja');
  });

  it('GET :codigo with an unknown code is a 404', () => {
    expect(() => controller.obtener('XX')).toThrow(NotFoundException);
  });
});
