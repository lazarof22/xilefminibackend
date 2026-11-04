import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';
import { ArqueoCajaService } from './arqueo-caja.service';
import { CreateArqueoCajaDto } from './dto/create-arqueo-caja.dto';

/** Arqueo SC-3-06: Administrador, Económico y Gerente (doc §6.9). */
export const ROLES_ARQUEO = [
  UsuarioRol.ADMIN,
  UsuarioRol.ECONOMICO,
  UsuarioRol.GERENTE,
];

@ApiTags('Arqueo de caja (SC-3-06)')
@ApiBearerAuth()
@Controller('arqueo-caja')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_ARQUEO)
export class ArqueoCajaController {
  constructor(private readonly arqueoCajaService: ArqueoCajaService) {}

  @Post()
  @ApiOperation({
    summary:
      'Registrar el arqueo formal SC-3-06 de un turno (esperado y diferencia por moneda, calculados en el servidor)',
  })
  @ApiResponse({ status: 201, description: 'Arqueo registrado' })
  @ApiResponse({
    status: 400,
    description: 'Falta el contado de una moneda o es inválido',
  })
  @ApiResponse({ status: 403, description: 'Rol sin permiso para arquear' })
  @ApiResponse({ status: 404, description: 'Turno inexistente' })
  @ApiResponse({ status: 409, description: 'El turno ya tiene arqueo' })
  crear(@Body() dto: CreateArqueoCajaDto, @Req() req: RequestWithUser) {
    return this.arqueoCajaService.crear(dto, req.user.userId);
  }

  @Get('esperado/:turnoCajaId')
  @ApiOperation({
    summary:
      'Efectivo esperado por moneda de un turno (fondo + entradas - salidas físicas) para precargar el arqueo',
  })
  @ApiParam({ name: 'turnoCajaId', description: 'ID del turno de caja' })
  esperado(@Param('turnoCajaId') turnoCajaId: string) {
    return this.arqueoCajaService.esperadoDelTurno(turnoCajaId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar arqueos (más recientes primero)' })
  @ApiQuery({ name: 'turnoCajaId', required: false })
  listar(@Query('turnoCajaId') turnoCajaId?: string) {
    return this.arqueoCajaService.listar(turnoCajaId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un arqueo' })
  @ApiParam({ name: 'id', description: 'ID del arqueo' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id') id: string) {
    return this.arqueoCajaService.findOne(id);
  }
}
