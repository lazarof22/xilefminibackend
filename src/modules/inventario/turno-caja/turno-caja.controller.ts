import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { TurnoCajaService } from './turno-caja.service';
import { AbrirTurnoCajaDto } from './dto/abrir-turno-caja.dto';
import { CerrarTurnoCajaDto } from './dto/cerrar-turno-caja.dto';
import { ListarTurnosCajaQueryDto } from './dto/listar-turnos-caja-query.dto';

/** Abrir y cerrar turno: Cajero y Administrador (doc §6.9). */
export const ROLES_TURNO_CAJA = [UsuarioRol.CAJERO, UsuarioRol.ADMIN];

@ApiTags('Turno de caja')
@ApiBearerAuth()
@Controller('turno-caja')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TurnoCajaController {
  constructor(private readonly turnoCajaService: TurnoCajaService) {}

  @Post()
  @Roles(...ROLES_TURNO_CAJA)
  @ApiOperation({
    summary:
      'Abrir el turno del cajero autenticado con su fondo inicial por moneda',
  })
  @ApiResponse({ status: 201, description: 'Turno abierto' })
  @ApiResponse({ status: 400, description: 'Fondo inicial inválido' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso para abrir turno' })
  @ApiResponse({
    status: 409,
    description: 'El cajero ya tiene un turno abierto',
  })
  abrir(@Body() dto: AbrirTurnoCajaDto, @Req() req: RequestWithUser) {
    return this.turnoCajaService.abrir(req.user, dto);
  }

  @Get('abierto')
  @ApiOperation({
    summary: 'Turno abierto del usuario autenticado (vacío si no tiene)',
  })
  @ApiResponse({ status: 200, description: 'Turno abierto o respuesta vacía' })
  abierto(@Req() req: RequestWithUser) {
    return this.turnoCajaService.abiertoDe(req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar turnos de caja (más recientes primero)' })
  @ApiResponse({ status: 200, description: 'Lista de turnos' })
  listar(@Query() query: ListarTurnosCajaQueryDto) {
    return this.turnoCajaService.listar(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un turno de caja' })
  @ApiParam({ name: 'id', description: 'ID del turno' })
  @ApiResponse({ status: 200, description: 'Turno' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id') id: string) {
    return this.turnoCajaService.findOne(id);
  }

  @Patch(':id/cerrar')
  @Roles(...ROLES_TURNO_CAJA)
  @ApiOperation({ summary: 'Cerrar un turno abierto' })
  @ApiParam({ name: 'id', description: 'ID del turno' })
  @ApiResponse({ status: 200, description: 'Turno cerrado' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso o turno ajeno' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  @ApiResponse({ status: 409, description: 'El turno ya está cerrado' })
  cerrar(
    @Param('id') id: string,
    @Body() dto: CerrarTurnoCajaDto,
    @Req() req: RequestWithUser,
  ) {
    return this.turnoCajaService.cerrar(id, req.user, dto);
  }
}
