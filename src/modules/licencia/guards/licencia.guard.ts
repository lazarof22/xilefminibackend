import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { LicenciaService } from '../licencia.service';
import type { EstadoLicencia } from '../types/licencia.types';

interface GuardRequest {
  user?: { empresa_id?: string; rol?: string };
  licenciaEstado?: EstadoLicencia;
}

/**
 * Requires a valid license for the empresa of the JWT.
 *
 * NOT WIRED: by product decision this guard is not applied to any route nor
 * registered as APP_GUARD yet. It is kept correct and fail-closed so it can be
 * wired later:
 * - no `req.user` → 401;
 * - empresa comes ONLY from the JWT (no body/header overrides, also for
 *   admins); a JWT without empresa evaluates the install-wide license;
 * - invalid license or ANY error → 403 with a generic message (details stay in
 *   the audit log / admin endpoints).
 */
@Injectable()
export class LicenciaGuard implements CanActivate {
  private readonly logger = new Logger(LicenciaGuard.name);

  constructor(private readonly licenciaService: LicenciaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    if (!request.user) {
      throw new UnauthorizedException('No autenticado');
    }

    let estado: EstadoLicencia;
    try {
      estado = await this.licenciaService.verificarEstado(
        request.user.empresa_id,
      );
    } catch (error) {
      this.logger.error(
        `License guard check failed: ${(error as Error).message}`,
      );
      throw new ForbiddenException('Licencia no válida');
    }

    if (!estado.valida) {
      throw new ForbiddenException('Licencia no válida');
    }
    request.licenciaEstado = estado;
    return true;
  }
}
