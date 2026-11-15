import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
import { FichasNormativasService } from './fichas-normativas.service';
import { FichaNormativa } from './ficha-normativa.types';

/** Roles that can read the normative sheets (doc 6.9). */
export const ROLES_FICHAS_NORMATIVAS = [
  UsuarioRol.ADMIN,
  UsuarioRol.GERENTE,
  UsuarioRol.ECONOMICO,
];

@ApiTags('Configuración - Fichas normativas')
@ApiBearerAuth()
@Controller('configuracion/fichas-normativas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_FICHAS_NORMATIVAS)
export class FichasNormativasController {
  constructor(private readonly service: FichasNormativasService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar las fichas normativas por tipo de documento',
  })
  @ApiResponse({ status: 200, description: 'Fichas normativas' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Solo administrador, gerente o económico',
  })
  listar(): FichaNormativa[] {
    return this.service.listar();
  }

  @Get(':codigo')
  @ApiOperation({ summary: 'Obtener la ficha normativa de un documento' })
  @ApiParam({ name: 'codigo', example: 'SC-2-04' })
  @ApiResponse({ status: 200, description: 'Ficha normativa' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({
    status: 403,
    description: 'Solo administrador, gerente o económico',
  })
  @ApiResponse({ status: 404, description: 'Código de ficha desconocido' })
  obtener(@Param('codigo') codigo: string): FichaNormativa {
    return this.service.obtener(codigo);
  }
}
