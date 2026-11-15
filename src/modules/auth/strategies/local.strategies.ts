import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import type { UsuariosDocument } from '../schemas/usuarios.schema';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'nombre', passwordField: 'contraseña' });
  }

  async validate(
    nombre: string,
    contraseña: string,
  ): Promise<UsuariosDocument> {
    // Este guard corre antes del ValidationPipe: un número, un objeto o un arreglo
    // llegarían a `trim()` y a bcrypt y terminarían en un 500.
    if (typeof nombre !== 'string' || typeof contraseña !== 'string') {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    const usuario = await this.authService.validateUser(nombre, contraseña);
    if (!usuario) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    return usuario;
  }
}
