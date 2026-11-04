import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JWT_SECRET } from './constants/constants';
import {
  Usuarios,
  UsuariosDocument,
  UsuarioRol,
} from './schemas/usuarios.schema';

export const ROLES_SUPERVISOR: string[] = [
  UsuarioRol.ADMIN,
  UsuarioRol.GERENTE,
];

export const MENSAJE_EXTRACCION_NO_AUTORIZADA =
  'Solo un administrador o gerente puede autorizar una extracción de caja';

export interface Supervisor {
  userId: string;
  nombre: string;
}

export const esRolSupervisor = (rol: string | undefined): boolean =>
  rol !== undefined && ROLES_SUPERVISOR.includes(rol);

interface PayloadSupervisor {
  sub?: unknown;
}

/**
 * Valida el token de acceso de un supervisor (administrador o gerente) que
 * autoriza una acción de otro usuario con sesión propia (p. ej. el cajero
 * extrae efectivo). El token se verifica con la misma clave que las sesiones y
 * el rol se lee de la base de datos, no del token: si el usuario se borró o
 * cambió de rol, deja de valer. El token nunca se registra ni se guarda.
 */
@Injectable()
export class AutorizadorSupervisorService {
  constructor(
    private readonly jwtService: JwtService,
    @InjectModel(Usuarios.name)
    private readonly userModel: Model<UsuariosDocument>,
  ) {}

  async verificar(token: string): Promise<Supervisor> {
    let payload: PayloadSupervisor;
    try {
      payload = await this.jwtService.verifyAsync<PayloadSupervisor>(token, {
        secret: JWT_SECRET,
      });
    } catch {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    if (typeof payload.sub !== 'string') {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    const user = await this.userModel.findById(payload.sub).lean().exec();
    if (!user || !esRolSupervisor(user.rol)) {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    return { userId: String(user._id), nombre: user.nombre };
  }
}
