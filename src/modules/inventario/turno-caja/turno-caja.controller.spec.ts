import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { TurnoCajaController } from './turno-caja.controller';
import { TurnoCajaService } from './turno-caja.service';

const GUARDS_METADATA_KEY = '__guards__';
const ROLES_METADATA_KEY = 'roles';

/* eslint-disable @typescript-eslint/unbound-method */
const proto = TurnoCajaController.prototype;
/* eslint-enable @typescript-eslint/unbound-method */

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => TurnoCajaController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

describe('TurnoCajaController', () => {
  let controller: TurnoCajaController;
  const servicio = {
    abrir: jest.fn().mockResolvedValue({ ok: 1 }),
    cerrar: jest.fn().mockResolvedValue({ ok: 2 }),
    abiertoDe: jest.fn().mockResolvedValue(null),
    listar: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [TurnoCajaController],
      providers: [{ provide: TurnoCajaService, useValue: servicio }],
    }).compile();
    controller = mod.get(TurnoCajaController);
  });

  it('exige JWT y roles en todo el controlador', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      TurnoCajaController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('abrir y cerrar son solo de cajero y administrador (403 para el resto)', () => {
    const esperado = [UsuarioRol.CAJERO, UsuarioRol.ADMIN];
    for (const h of [proto.abrir, proto.cerrar]) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, h)).toEqual(esperado);
    }
    const guard = new RolesGuard(new Reflector());
    expect(
      guard.canActivate(contexto(UsuarioRol.FACTURADOR, proto.abrir)),
    ).toBe(false);
    expect(guard.canActivate(contexto(UsuarioRol.CAJERO, proto.abrir))).toBe(
      true,
    );
    expect(guard.canActivate(contexto(UsuarioRol.ADMIN, proto.cerrar))).toBe(
      true,
    );
  });

  it('las lecturas no llevan @Roles', () => {
    for (const h of [proto.abierto, proto.listar, proto.findOne]) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, h)).toBeUndefined();
    }
  });

  it('usa el usuario autenticado como cajero', async () => {
    const req = {
      user: { userId: 'u1', nombre: 'Ana', rol: 'cajero', modulos: [] },
    };
    await controller.abrir({ fondoInicial: { CUP: 1 } }, req);
    expect(servicio.abrir).toHaveBeenCalledWith(req.user, {
      fondoInicial: { CUP: 1 },
    });
    await controller.abierto(req);
    expect(servicio.abiertoDe).toHaveBeenCalledWith('u1');
    await controller.cerrar('t1', {}, req);
    expect(servicio.cerrar).toHaveBeenCalledWith('t1', req.user, {});
  });
});
