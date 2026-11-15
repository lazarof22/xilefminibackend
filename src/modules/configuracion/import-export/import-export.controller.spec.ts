import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ImportExportController } from './import-export.controller';

const proto = ImportExportController.prototype as unknown as Record<
  string,
  (...a: never[]) => unknown
>;

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => ImportExportController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

describe('ImportExportController roles', () => {
  it('requires JWT and roles guards and administrador for backup routes', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      ImportExportController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata('roles', ImportExportController)).toEqual([
      'administrador',
    ]);
    const guard = new RolesGuard(new Reflector());
    for (const nombre of ['exportar', 'importar']) {
      expect(guard.canActivate(contexto('gerente', proto[nombre]))).toBe(false);
      expect(guard.canActivate(contexto('administrador', proto[nombre]))).toBe(
        true,
      );
    }
  });
});
