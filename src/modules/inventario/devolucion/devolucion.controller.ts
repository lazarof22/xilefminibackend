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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';
import { DevolucionService } from './devolucion.service';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import { ListarDevolucionesQueryDto } from './dto/listar-devoluciones-query.dto';

/** Doc §6.9: anular factura / venta (devolver mercancía) -> Administrador, Gerente. */
export const ROLES_CREAR_DEVOLUCION = [UsuarioRol.ADMIN, UsuarioRol.GERENTE];

@ApiTags('Devoluciones')
@ApiBearerAuth()
@Controller('devolucion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevolucionController {
  constructor(private readonly devolucionService: DevolucionService) {}

  @Post()
  @Roles(...ROLES_CREAR_DEVOLUCION)
  @ApiOperation({
    summary: 'Emitir un Vale de Entrega o Devolución (SC-2-08)',
    description:
      'Referencia siempre su origen (venta, factura o compra). Repone stock y escribe Kardex `devolucion` (venta/factura) o registra una salida a proveedor. El importe y la forma de devolución del dinero los deduce el servidor del pago original.',
  })
  @ApiResponse({ status: 201, description: 'Devolución registrada' })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o tope devuelto superado',
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Rol sin permiso (solo administrador o gerente)',
  })
  @ApiResponse({ status: 404, description: 'El origen no existe' })
  @ApiResponse({ status: 409, description: 'El origen no admite devolución' })
  crear(@Body() dto: CreateDevolucionDto, @Req() req: RequestWithUser) {
    return this.devolucionService.registrar(dto, req.user);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar devoluciones',
    description:
      'Para el cuadre de caja: `?formaDevolucionDinero=efectivo&desde=&hasta=` devuelve el efectivo devuelto en el periodo. Por defecto solo las registradas.',
  })
  @ApiResponse({ status: 200, description: 'Listado paginado' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  listar(@Query() query: ListarDevolucionesQueryDto) {
    return this.devolucionService.listar(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una devolución por ID' })
  @ApiParam({ name: 'id', description: 'ID de la devolución' })
  @ApiResponse({ status: 200, description: 'Devolución encontrada' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  findOne(@Param('id') id: string) {
    return this.devolucionService.findOne(id);
  }
}
