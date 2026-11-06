import { HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AutorizadorSupervisorService,
  BLOQUEO_INTENTOS_MS,
  MAX_INTENTOS_FALLIDOS,
} from './autorizador-supervisor.service';
import { AuthService } from './auth.service';
import { UsuarioRol } from './schemas/usuarios.schema';

describe('AutorizadorSupervisorService lockout', () => {
  const gerente = { _id: 'g1', nombre: 'gerente', rol: UsuarioRol.GERENTE };
  let validateUser: jest.Mock;
  let servicio: AutorizadorSupervisorService;

  beforeEach(() => {
    validateUser = jest.fn().mockResolvedValue(null);
    servicio = new AutorizadorSupervisorService(
      new JwtService({ secret: 'x' }),
      { validateUser } as unknown as AuthService,
      {} as never,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('parallel attempts cannot get past the limit: the check and the count happen before any await', async () => {
    const resultados = await Promise.allSettled(
      Array.from({ length: 20 }, () => servicio.emitir('g', 'mala', 'u1')),
    );

    expect(validateUser).toHaveBeenCalledTimes(MAX_INTENTOS_FALLIDOS);
    const bloqueados = resultados.filter(
      (r) =>
        r.status === 'rejected' &&
        (r.reason as HttpException).getStatus() ===
          HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(bloqueados).toHaveLength(20 - MAX_INTENTOS_FALLIDOS);
  });

  it('the block expires after the window and the counter starts over', async () => {
    const ahora = Date.now();
    const reloj = jest.spyOn(Date, 'now').mockReturnValue(ahora);
    for (let i = 0; i < MAX_INTENTOS_FALLIDOS; i++)
      await servicio.emitir('g', 'mala', 'u1').catch(() => undefined);
    await expect(servicio.emitir('g', 'mala', 'u1')).rejects.toBeInstanceOf(
      HttpException,
    );

    reloj.mockReturnValue(ahora + BLOQUEO_INTENTOS_MS + 1);
    validateUser.mockResolvedValue(gerente);
    await expect(servicio.emitir('g', 'ok', 'u1')).resolves.toMatchObject({
      autorizadoPor: 'gerente',
    });
  });

  it('forgets expired entries so the map does not grow without bound', async () => {
    const ahora = Date.now();
    const reloj = jest.spyOn(Date, 'now').mockReturnValue(ahora);
    for (let u = 0; u < 50; u++)
      await servicio.emitir('g', 'mala', `u${u}`).catch(() => undefined);
    reloj.mockReturnValue(ahora + BLOQUEO_INTENTOS_MS + 1);
    await servicio.emitir('g', 'mala', 'otro').catch(() => undefined);

    const tamano = (servicio as unknown as { fallidos: Map<string, unknown> })
      .fallidos.size;
    expect(tamano).toBe(1);
  });
});
