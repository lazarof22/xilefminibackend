import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Model, isValidObjectId } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { obtenerJwtSecret } from '../constants/constants';
import {
  Usuarios,
  UsuariosDocument,
  modulosEfectivos,
} from '../schemas/usuarios.schema';
import type { JwtUser } from '../types/jwt-user.type';

interface PayloadJwt {
  sub: string;
  /** Los tokens de sesión no llevan audiencia; los de una acción concreta (p. ej. extracción) sí. */
  aud?: unknown;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(Usuarios.name)
    private readonly userModel: Model<UsuariosDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: obtenerJwtSecret(),
    });
  }

  /**
   * El rol y los módulos se leen de la base de datos en cada petición (no del
   * token): si se borra o se cambia a un usuario, el efecto es inmediato.
   */
  async validate(payload: PayloadJwt): Promise<JwtUser> {
    // Un token emitido para una acción acotada no es una sesión: si lo fuera, quien lo recibe
    // (el cajero) actuaría con el rol del supervisor que lo autorizó.
    if (payload.aud !== undefined) {
      throw new UnauthorizedException('Token no válido como sesión');
    }
    // `sub` es el id del usuario: un objeto o un arreglo no es una sesión (y no debe llegar a la consulta).
    if (typeof payload.sub !== 'string' || !isValidObjectId(payload.sub)) {
      throw new UnauthorizedException('Token no válido como sesión');
    }
    const user = await this.userModel.findById(payload.sub).lean().exec();
    if (!user) throw new UnauthorizedException('El usuario ya no existe');
    return {
      userId: String(user._id),
      nombre: user.nombre,
      rol: user.rol,
      modulos: modulosEfectivos(user),
    };
  }
}
