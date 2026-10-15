import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import type { RespuestaLogin, UsuarioSesion } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import type { RequestWithUser } from './types/jwt-user.type';
import type { UsuariosDocument } from './schemas/usuarios.schema';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({
    summary: 'Iniciar sesión con nombre de usuario y contraseña',
  })
  @ApiBody({ type: LoginDto })
  @UseGuards(ThrottlerGuard, LocalAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  login(@Request() req: { user: UsuariosDocument }): RespuestaLogin {
    return this.authService.login(req.user);
  }

  @ApiOperation({ summary: 'Usuario autenticado (rol y módulos actuales)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('perfil')
  perfil(@Request() req: RequestWithUser): Promise<UsuarioSesion> {
    return this.authService.perfil(req.user.userId);
  }
}
