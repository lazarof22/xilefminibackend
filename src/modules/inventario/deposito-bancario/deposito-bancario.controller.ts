import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';
import { DepositoBancarioService } from './deposito-bancario.service';
import { CreateDepositoBancarioDto } from './dto/create-deposito-bancario.dto';
import { ListarDepositosQueryDto } from './dto/listar-depositos-query.dto';
import { UpdateConfiguracionDepositoDto } from './dto/update-configuracion-deposito.dto';

/** Quién registra depósitos del efectivo de caja. */
export const ROLES_REGISTRAR_DEPOSITO = [
  UsuarioRol.CAJERO,
  UsuarioRol.ADMIN,
  UsuarioRol.ECONOMICO,
  UsuarioRol.GERENTE,
];

@ApiTags('Depósito bancario')
@ApiBearerAuth()
@Controller('deposito-bancario')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepositoBancarioController {
  constructor(private readonly service: DepositoBancarioService) {}

  @Post()
  @Roles(...ROLES_REGISTRAR_DEPOSITO)
  @ApiOperation({
    summary: 'Registrar el depósito bancario del efectivo de un turno',
  })
  @ApiResponse({ status: 201, description: 'Depósito registrado' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso' })
  @ApiResponse({ status: 404, description: 'Turno inexistente' })
  registrar(
    @Body() dto: CreateDepositoBancarioDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.registrar(dto, req.user.userId, req.user.rol);
  }

  @Get('alertas')
  @ApiOperation({
    summary:
      'Alertas de plazo de depósito; solo activas si el flag de configuración está encendido',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ activas, alertas[] }; apagado: { activas: false, alertas: [] }',
  })
  alertas() {
    return this.service.alertas();
  }

  @Get('configuracion')
  @ApiOperation({ summary: 'Configuración de las alertas de plazo' })
  configuracion() {
    return this.service.obtenerConfiguracion();
  }

  @Put('configuracion')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({
    summary: 'Activar/desactivar y configurar las alertas (solo administrador)',
  })
  @ApiResponse({ status: 403, description: 'Solo el administrador' })
  actualizarConfiguracion(@Body() dto: UpdateConfiguracionDepositoDto) {
    return this.service.actualizarConfiguracion(dto);
  }

  @Get()
  @Roles(...ROLES_REGISTRAR_DEPOSITO)
  @ApiOperation({ summary: 'Listar depósitos (más recientes primero)' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso' })
  listar(@Query() query: ListarDepositosQueryDto, @Req() req: RequestWithUser) {
    return this.service.listar(query, req.user);
  }

  @Get(':id')
  @Roles(...ROLES_REGISTRAR_DEPOSITO)
  @ApiOperation({ summary: 'Obtener un depósito' })
  @ApiParam({ name: 'id', description: 'ID del depósito' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.service.findOne(id, req.user);
  }
}
