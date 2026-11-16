import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenciaGlobalGuard } from './licencia-global.guard';
import { SinLicencia } from '../decorators/sin-licencia.decorator';
import type { LicenciaService } from '../licencia.service';

@SinLicencia()
class ControladorExento {
  ruta(): void {}
}
class ControladorNormal {
  ruta(): void {}
  @SinLicencia()
  exenta(): void {}
}

function contexto(
  clase: new () => object,
  metodo: string,
  cabeceras: Record<string, string> = {},
  tipo = 'http',
): ExecutionContext {
  return {
    getType: () => tipo,
    getClass: () => clase,
    getHandler: () => (clase.prototype as Record<string, () => void>)[metodo],
    switchToHttp: () => ({ getRequest: () => ({ headers: cabeceras }) }),
  } as unknown as ExecutionContext;
}

describe('LicenciaGlobalGuard', () => {
  const instalacionLicenciada = jest.fn();
  const guard = new LicenciaGlobalGuard(
    { instalacionLicenciada } as unknown as LicenciaService,
    new Reflector(),
  );
  const conToken = { authorization: 'Bearer a.b.c' };

  beforeEach(() => instalacionLicenciada.mockReset());

  it('lets an authenticated request through when the install is licensed', async () => {
    instalacionLicenciada.mockResolvedValue(true);

    await expect(
      guard.canActivate(contexto(ControladorNormal, 'ruta', conToken)),
    ).resolves.toBe(true);
  });

  it('answers 403 with the stable code licencia_invalida when it is not', async () => {
    instalacionLicenciada.mockResolvedValue(false);

    const fallo = await guard
      .canActivate(contexto(ControladorNormal, 'ruta', conToken))
      .catch((e: ForbiddenException) => e);

    expect(fallo).toBeInstanceOf(ForbiddenException);
    expect((fallo as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      message: 'Licencia no válida',
      codigo: 'licencia_invalida',
    });
  });

  it('fails closed when the check itself throws', async () => {
    instalacionLicenciada.mockRejectedValue(new Error('boom'));

    await expect(
      guard.canActivate(contexto(ControladorNormal, 'ruta', conToken)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a request without credentials passes through: the JWT guard answers 401, public routes stay public', async () => {
    await expect(
      guard.canActivate(contexto(ControladorNormal, 'ruta')),
    ).resolves.toBe(true);
    expect(instalacionLicenciada).not.toHaveBeenCalled();
  });

  it('@SinLicencia exempts a whole controller or a single handler, even without a license', async () => {
    instalacionLicenciada.mockResolvedValue(false);

    await expect(
      guard.canActivate(contexto(ControladorExento, 'ruta', conToken)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contexto(ControladorNormal, 'exenta', conToken)),
    ).resolves.toBe(true);
    expect(instalacionLicenciada).not.toHaveBeenCalled();
  });

  it('ignores non-HTTP contexts', async () => {
    await expect(
      guard.canActivate(contexto(ControladorNormal, 'ruta', conToken, 'rpc')),
    ).resolves.toBe(true);
  });
});
