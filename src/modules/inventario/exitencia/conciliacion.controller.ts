import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConciliacionService } from './conciliacion.service';
import { ResolverConciliacionDto } from './dto/resolver-conciliacion.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';

/** Quién puede ver la conciliación y quién puede cambiar saldos. */
const ROLES_VER = [UsuarioRol.ADMIN, UsuarioRol.GERENTE, UsuarioRol.ECONOMICO];
const ROLES_AJUSTAR = [UsuarioRol.ADMIN, UsuarioRol.ECONOMICO];

@ApiTags('Existencias - Conciliación')
@ApiBearerAuth()
@Controller('existencias/conciliacion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConciliacionController {
  constructor(private readonly conciliacionService: ConciliacionService) {}

  @Get()
  @Roles(...ROLES_VER)
  @ApiOperation({
    summary:
      'Productos cuyo stock no coincide con la suma de sus existencias por ubicación',
  })
  @ApiResponse({ status: 200, description: 'Reporte de conciliación' })
  obtenerReporte() {
    return this.conciliacionService.obtenerReporte();
  }

  @Post('resolver')
  @Roles(...ROLES_AJUSTAR)
  @ApiOperation({
    summary:
      'Resuelve la diferencia de un producto (stock del producto, existencias o conteo físico)',
  })
  @ApiResponse({ status: 201, description: 'Producto conciliado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({
    status: 409,
    description: 'El producto cambió mientras se conciliaba',
  })
  resolver(@Body() dto: ResolverConciliacionDto, @Req() req: RequestWithUser) {
    return this.conciliacionService.resolver(dto, req.user.nombre);
  }

  @Post('activar')
  @Roles(UsuarioRol.ADMIN)
  @ApiOperation({
    summary:
      'Activa el modo unificado (solo si no queda ningún producto con diferencias)',
  })
  @ApiResponse({ status: 201, description: 'Modo unificado activo' })
  @ApiResponse({ status: 409, description: 'Aún hay diferencias' })
  activar(@Req() req: RequestWithUser) {
    return this.conciliacionService.activar(req.user.nombre);
  }
}
