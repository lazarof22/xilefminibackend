import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FacturaService } from './factura.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import { ListarFacturasQueryDto } from './dto/listar-facturas-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UsuarioRol } from '../auth/schemas/empleado.schema';
import type { RequestWithUser } from '../auth/types/jwt-user.type';

/**
 * Write endpoints (create/update/anular/remove) require these roles (T4).
 * Read endpoints (findAll/findOne) carry no `@Roles`, so `RolesGuard`
 * leaves them open to any authenticated user (see `RolesGuard.canActivate`:
 * no metadata -> allow).
 */
const ROLES_ESCRITURA = [
  UsuarioRol.ADMIN,
  UsuarioRol.GERENTE,
  UsuarioRol.FACTURADOR,
];

@ApiTags('Facturas')
@ApiBearerAuth()
@Controller('facturas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FacturaController {
  constructor(private readonly facturaService: FacturaService) {}

  @Post()
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({ summary: 'Registrar una nueva factura' })
  @ApiResponse({ status: 201, description: 'Factura registrada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para facturar',
  })
  create(
    @Body() createFacturaDto: CreateFacturaDto,
    @Req() req: RequestWithUser,
  ) {
    return this.facturaService.create(createFacturaDto, req.user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las facturas' })
  @ApiResponse({ status: 200, description: 'Facturas obtenidas con exito' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  findAll(@Query() query: ListarFacturasQueryDto) {
    return this.facturaService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una factura por ID' })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({ status: 200, description: 'Factura encontrada' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  findOne(@Param('id') id: string) {
    return this.facturaService.findOne(id);
  }

  @Patch(':id')
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({
    summary:
      'Modificar una factura (que campos se aceptan depende del estado actual)',
  })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({ status: 200, description: 'Factura modificada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para modificar',
  })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  @ApiResponse({
    status: 409,
    description:
      'Se envio un campo que el estado actual de la factura no permite modificar',
  })
  update(@Param('id') id: string, @Body() updateFacturaDto: UpdateFacturaDto) {
    return this.facturaService.update(id, updateFacturaDto);
  }

  @Patch(':id/terminar')
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({
    summary: 'Terminar una factura (cierra el flujo normal de edicion)',
  })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({ status: 200, description: 'Factura terminada con exito' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para terminar',
  })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  @ApiResponse({
    status: 409,
    description: 'La factura no esta en edicion',
  })
  terminar(@Param('id') id: string) {
    return this.facturaService.terminar(id);
  }

  @Patch(':id/editar')
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({
    summary: 'Volver a edicion una factura terminada',
  })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({
    status: 200,
    description: 'Factura vuelta a edicion con exito',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para editar',
  })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  @ApiResponse({
    status: 409,
    description: 'La factura no esta terminada',
  })
  volverAEdicion(@Param('id') id: string) {
    return this.facturaService.volverAEdicion(id);
  }

  @Patch(':id/confirmar')
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({
    summary: 'Confirmar una factura terminada',
  })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({ status: 200, description: 'Factura confirmada con exito' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para confirmar',
  })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  @ApiResponse({
    status: 409,
    description: 'La factura no esta terminada',
  })
  confirmar(@Param('id') id: string) {
    return this.facturaService.confirmar(id);
  }

  @Patch(':id/cancelar')
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({
    summary: 'Cancelar una factura confirmada (reversa)',
  })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({ status: 200, description: 'Factura cancelada con exito' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para cancelar',
  })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  @ApiResponse({
    status: 409,
    description: 'La factura no esta confirmada',
  })
  cancelar(@Param('id') id: string) {
    return this.facturaService.cancelar(id);
  }

  @Patch(':id/anular')
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({
    summary: 'Anular una factura (conserva el registro por obligacion legal)',
  })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({ status: 200, description: 'Factura anulada con exito' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para anular',
  })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  @ApiResponse({ status: 409, description: 'La factura ya esta anulada' })
  anular(@Param('id') id: string) {
    return this.facturaService.anular(id);
  }

  @Delete(':id')
  @Roles(...ROLES_ESCRITURA)
  @ApiOperation({
    summary: 'Anular una factura (baja blanda, conserva el registro)',
  })
  @ApiParam({ name: 'id', description: 'ID de la factura' })
  @ApiResponse({ status: 200, description: 'Factura anulada con exito' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso para anular',
  })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  @ApiResponse({ status: 409, description: 'La factura ya esta anulada' })
  remove(@Param('id') id: string) {
    return this.facturaService.remove(id);
  }
}
