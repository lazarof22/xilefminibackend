import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfiguracionTributariaService } from './configuracion-tributaria.service';
import { GuardarConfiguracionTributariaDto } from './dto/guardar-configuracion-tributaria.dto';
import { ConfiguracionTributariaDocument } from './schemas/configuracion-tributaria.schema';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';

/** Roles que pueden cambiar la configuración tributaria. */
const ROLES_ESCRITURA = [
  UsuarioRol.ADMIN,
  UsuarioRol.GERENTE,
  UsuarioRol.ECONOMICO,
];

/**
 * Las lecturas no llevan `@Roles`: `RolesGuard` las deja abiertas a
 * cualquier usuario autenticado.
 */
@ApiTags('Configuración tributaria')
@ApiBearerAuth()
@Controller('configuracion-tributaria')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class ConfiguracionTributariaController {
  constructor(private readonly service: ConfiguracionTributariaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Configuración tributaria vigente' })
  @ApiResponse({
    status: 200,
    description:
      'Configuración activa. Si nunca se configuró responde 200 con cuerpo vacío (null): la UI muestra "sin configurar".',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  obtenerActiva(): Promise<ConfiguracionTributariaDocument | null> {
    return this.service.obtenerActiva();
  }

  @Get('historial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Historial de configuraciones tributarias (auditoría)',
  })
  @ApiResponse({ status: 200, description: 'Más reciente primero' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  historial(): Promise<ConfiguracionTributariaDocument[]> {
    return this.service.historial();
  }

  @Put()
  @Roles(...ROLES_ESCRITURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Guardar una nueva configuración tributaria (administrador, gerente, económico)',
    description:
      'Crea un documento nuevo con `vigenteDesde` y desactiva el anterior; los anteriores quedan en el historial.',
  })
  @ApiResponse({ status: 200, description: 'Configuración vigente guardada' })
  @ApiResponse({ status: 400, description: 'Porcentaje o fecha inválidos' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso' })
  guardar(
    @Body() dto: GuardarConfiguracionTributariaDto,
  ): Promise<ConfiguracionTributariaDocument> {
    return this.service.guardar(dto);
  }
}
