import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { LicenciaGuard } from './licencia.guard';
import { LicenciaService } from '../licencia.service';

function ctx(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('LicenciaGuard (not wired; must fail closed)', () => {
  let verificarEstado: jest.Mock;
  let guard: LicenciaGuard;

  beforeEach(() => {
    verificarEstado = jest.fn();
    guard = new LicenciaGuard({
      verificarEstado,
    } as unknown as LicenciaService);
  });

  it('rejects unauthenticated requests', async () => {
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows a valid license and attaches the status', async () => {
    verificarEstado.mockResolvedValue({ valida: true, estado: 'valida' });
    const request: Record<string, unknown> = {
      user: { rol: 'empleado', empresa_id: 'E1' },
    };
    await expect(guard.canActivate(ctx(request))).resolves.toBe(true);
    expect(verificarEstado).toHaveBeenCalledWith('E1');
    expect(request.licenciaEstado).toEqual({ valida: true, estado: 'valida' });
  });

  it('ignores body/header empresa overrides, even for admins', async () => {
    verificarEstado.mockResolvedValue({ valida: true, estado: 'valida' });
    await guard.canActivate(
      ctx({
        user: { rol: 'administrador', empresa_id: 'E1' },
        body: { empresa_id: 'E2' },
        headers: { 'x-empresa-id': 'E3' },
      }),
    );
    expect(verificarEstado).toHaveBeenCalledWith('E1');
  });

  it('rejects an invalid license without leaking details', async () => {
    verificarEstado.mockResolvedValue({
      valida: false,
      estado: 'expirada',
      dias_restantes: 0,
    });
    const err = await guard
      .canActivate(ctx({ user: { rol: 'empleado' } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(
      JSON.stringify((err as ForbiddenException).getResponse()),
    ).not.toMatch(/d[ií]as/);
  });

  it('fails closed when the check throws', async () => {
    verificarEstado.mockRejectedValue(new Error('boom'));
    await expect(
      guard.canActivate(ctx({ user: { rol: 'empleado', empresa_id: 'E1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
