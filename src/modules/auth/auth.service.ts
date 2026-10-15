import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { JWT_EXPIRES_IN, JWT_SECRET } from './constants/constants';
import {
  COLLATION_NOMBRE,
  Usuarios,
  UsuariosDocument,
  modulosEfectivos,
} from './schemas/usuarios.schema';

export interface UsuarioSesion {
  id: string;
  nombre: string;
  rol: string;
  modulos: string[];
}

export interface RespuestaLogin {
  access_token: string;
  usuario: UsuarioSesion;
}

// Hash descartable para que una cuenta inexistente tarde lo mismo en
// rechazarse que una contraseña incorrecta (no revela qué usuarios existen).
const HASH_FALSO = bcrypt.hashSync('contraseña-inexistente', 10);

export function aUsuarioSesion(usuario: {
  _id: unknown;
  nombre: string;
  rol: string;
  modulos?: readonly string[];
}): UsuarioSesion {
  return {
    id: String(usuario._id),
    nombre: usuario.nombre,
    rol: usuario.rol,
    modulos: modulosEfectivos(usuario),
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Usuarios.name) private userModel: Model<UsuariosDocument>,
    private jwtService: JwtService,
  ) {}

  /** Devuelve el usuario (sin contraseña) si las credenciales son correctas. */
  async validateUser(
    nombre: string,
    contraseña: string,
  ): Promise<UsuariosDocument | null> {
    const user = await this.userModel
      .findOne({ nombre: nombre.trim() })
      .collation(COLLATION_NOMBRE)
      .select('+contraseña')
      .exec();

    const coincide = await bcrypt.compare(
      contraseña,
      user?.contraseña ?? HASH_FALSO,
    );
    if (!user || !coincide) return null;

    user.set('contraseña', undefined);
    return user;
  }

  login(usuario: {
    _id: unknown;
    nombre: string;
    rol: string;
    modulos?: readonly string[];
  }): RespuestaLogin {
    const sesion = aUsuarioSesion(usuario);
    const payload = {
      sub: sesion.id,
      nombre: sesion.nombre,
      rol: sesion.rol,
      modulos: sesion.modulos,
    };
    return {
      access_token: this.jwtService.sign(payload, {
        secret: JWT_SECRET,
        expiresIn: JWT_EXPIRES_IN,
      }),
      usuario: sesion,
    };
  }

  /** Datos actuales del usuario autenticado (rol y módulos al día). */
  async perfil(userId: string): Promise<UsuarioSesion> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return aUsuarioSesion(user);
  }
}
