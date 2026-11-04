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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';
import { RecepcionService } from './recepcion.service';
import { CreateRecepcionDto } from './dto/create-recepcion.dto';
import { UpdateRecepcionDto } from './dto/update-recepcion.dto';
import { EstadoRecepcion } from './schema/recepcion.schema';

/**
 * Crear, editar y registrar recepciones. La consulta (GET) no lleva
 * `@Roles`: `RolesGuard` la deja abierta a cualquier usuario autenticado.
 */
export const ROLES_ESCRITURA_RECEPCION = [
  UsuarioRol.ADMIN,
  UsuarioRol.GERENTE,
  UsuarioRol.ECONOMICO,
];

@ApiTags('Recepción (SC-2-04)')
@ApiBearerAuth()
@Controller('recepcion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecepcionController {
  constructor(private readonly recepcionService: RecepcionService) {}

  @Post()
  @Roles(...ROLES_ESCRITURA_RECEPCION)
  @ApiOperation({
    summary:
      'Crear el borrador de un Informe de Recepción (no mueve el saldo del inventario)',
  })
  @ApiResponse({ status: 201, description: 'Borrador creado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso para recepcionar' })
  @ApiResponse({
    status: 404,
    description: 'Proveedor, almacén o producto inexistente',
  })
  crear(@Body() dto: CreateRecepcionDto, @Req() req: RequestWithUser) {
    return this.recepcionService.crear(dto, req.user);
  }

  @Patch(':id')
  @Roles(...ROLES_ESCRITURA_RECEPCION)
  @ApiOperation({ summary: 'Editar un borrador de recepción' })
  @ApiParam({ name: 'id', description: 'ID de la recepción' })
  @ApiResponse({ status: 200, description: 'Borrador actualizado' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso para recepcionar' })
  @ApiResponse({ status: 409, description: 'La recepción ya está registrada' })
  actualizar(@Param('id') id: string, @Body() dto: UpdateRecepcionDto) {
    return this.recepcionService.actualizar(id, dto);
  }

  @Post(':id/registrar')
  @Roles(...ROLES_ESCRITURA_RECEPCION)
  @ApiOperation({
    summary:
      'Registrar la recepción: aplica el saldo del inventario y escribe el kardex una sola vez',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción' })
  @ApiResponse({ status: 201, description: 'Recepción registrada' })
  @ApiResponse({ status: 403, description: 'Rol sin permiso para recepcionar' })
  @ApiResponse({ status: 409, description: 'La recepción ya está registrada' })
  registrar(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.recepcionService.registrar(id, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'Listar recepciones (más recientes primero)' })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoRecepcion })
  findAll(@Query('estado') estado?: EstadoRecepcion) {
    return this.recepcionService.findAll({ estado });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una recepción' })
  @ApiParam({ name: 'id', description: 'ID de la recepción' })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  findOne(@Param('id') id: string) {
    return this.recepcionService.findOne(id);
  }
}
