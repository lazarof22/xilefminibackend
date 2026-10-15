import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_SECRET } from '../constants/constants';
import {
  Usuarios,
  UsuariosDocument,
  modulosEfectivos,
} from '../schemas/usuarios.schema';
import type { JwtUser } from '../types/jwt-user.type';

interface PayloadJwt {
  sub: string;
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
      secretOrKey: JWT_SECRET,
    });
  }

  /**
   * El rol y los módulos se leen de la base de datos en cada petición (no del
   * token): si se borra o se cambia a un usuario, el efecto es inmediato.
   */
  async validate(payload: PayloadJwt): Promise<JwtUser> {
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
