import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { AjusteInventarioService } from './ajuste-inventario.service';
import { CreateAjusteInventarioDto } from './dto/create-ajuste-inventario.dto';

/** Ajuste de inventario SC-2-16: Administrador y Económico (doc §6.9). */
export const ROLES_AJUSTE_INVENTARIO = [UsuarioRol.ADMIN, UsuarioRol.ECONOMICO];

@ApiTags('Ajuste de inventario (SC-2-16)')
@ApiBearerAuth()
@Controller('ajuste-inventario')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_AJUSTE_INVENTARIO)
export class AjusteInventarioController {
  constructor(private readonly ajusteService: AjusteInventarioService) {}

  @Post()
  @ApiOperation({
    summary:
      'Registrar un ajuste SC-2-16 con causa, autorización y firma; el servidor lee el saldo antes y calcula el saldo después',
  })
  @ApiResponse({ status: 201, description: 'Ajuste aplicado' })
  @ApiResponse({
    status: 400,
    description:
      'Falta causa, autorización o firma; causa fuera del nomenclador; saldos enviados por el cliente; saldo negativo',
  })
  @ApiResponse({ status: 403, description: 'Rol sin permiso para ajustar' })
  @ApiResponse({
    status: 404,
    description: 'Producto o contenedor inexistente',
  })
  crear(@Body() dto: CreateAjusteInventarioDto, @Req() req: RequestWithUser) {
    return this.ajusteService.crear(dto, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'Listar ajustes (más recientes primero)' })
  findAll() {
    return this.ajusteService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un ajuste' })
  @ApiParam({ name: 'id', description: 'ID del ajuste' })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  findOne(@Param('id') id: string) {
    return this.ajusteService.findOne(id);
  }
}
