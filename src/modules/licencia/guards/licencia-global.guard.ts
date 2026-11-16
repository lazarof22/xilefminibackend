import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { LicenciaService } from '../licencia.service';
import { SIN_LICENCIA_KEY } from '../decorators/sin-licencia.decorator';

/** Stable code the frontend reads to send the user to the license screen. */
export const CODIGO_LICENCIA_INVALIDA = 'licencia_invalida';

/**
 * Registered as APP_GUARD: every authenticated request needs a valid license for this install.
 *
 * - It runs BEFORE the controller guards, so `req.user` does not exist yet and the check is
 *   install-wide (the same one `LicenciaGuard` does for a JWT without empresa).
 * - A request WITHOUT credentials passes through: the JWT guard of its controller answers 401,
 *   and the few public routes (login, public status) stay public.
 * - `@SinLicencia()` exempts login, the session and the license management itself.
 * - Fail closed: any error while checking answers 403.
 */
@Injectable()
export class LicenciaGlobalGuard implements CanActivate {
  private readonly logger = new Logger(LicenciaGlobalGuard.name);

  constructor(
    private readonly licenciaService: LicenciaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const exenta = this.reflector.getAllAndOverride<boolean | undefined>(
      SIN_LICENCIA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exenta) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.headers?.authorization) return true;

    let licenciada = false;
    try {
      licenciada = await this.licenciaService.instalacionLicenciada();
    } catch (error) {
      this.logger.error(
        `License guard check failed: ${(error as Error).message}`,
      );
    }
    if (!licenciada) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Licencia no válida',
        codigo: CODIGO_LICENCIA_INVALIDA,
      });
    }
    return true;
  }
}
