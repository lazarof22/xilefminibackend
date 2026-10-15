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
    const usuario = await this.authService.validateUser(nombre, contraseña);
    if (!usuario) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    return usuario;
  }
}
