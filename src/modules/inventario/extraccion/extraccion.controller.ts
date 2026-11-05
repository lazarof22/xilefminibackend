import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ExtraccionService } from './extraccion.service';
import {
  CreateExtraccionDto,
  SolicitarAutorizacionExtraccionDto,
} from './dto/create-extraccion.dto';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';

@ApiTags('Extraccion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('extraccion')
export class ExtraccionController {
  constructor(private readonly extraccionService: ExtraccionService) {}

  @Post('autorizacion')
  @ApiOperation({
    summary:
      'Un administrador o gerente entrega sus credenciales y recibe una autorización de un solo uso para que el usuario de esta sesión registre una extracción',
  })
  @ApiResponse({ status: 201, description: 'Autorización emitida' })
  @ApiResponse({
    status: 403,
    description: 'Credenciales inválidas o sin rol de administrador/gerente',
  })
  solicitarAutorizacion(
    @Body() dto: SolicitarAutorizacionExtraccionDto,
    @Req() req: RequestWithUser,
  ) {
    return this.extraccionService.emitirAutorizacion(dto, req.user);
  }

  @Post()
  @ApiOperation({
    summary:
      'Registrar una extracción de caja (se vincula al turno abierto del usuario autenticado). ' +
      'Requiere ser administrador o gerente, o enviar `tokenAutorizador` de uno de ellos.',
  })
  @ApiResponse({ status: 201, description: 'Extracción registrada' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({
    status: 403,
    description: 'Sin autorización de un administrador o gerente',
  })
  create(@Body() dto: CreateExtraccionDto, @Req() req: RequestWithUser) {
    return this.extraccionService.create(dto, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'Historial de extracciones de caja' })
  @ApiResponse({ status: 200, description: 'Lista de extracciones' })
  findAll() {
    return this.extraccionService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una extracción por ID' })
  @ApiParam({ name: 'id', description: 'ID de la extracción' })
  @ApiResponse({ status: 200, description: 'Extracción encontrada' })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  findOne(@Param('id') id: string) {
    return this.extraccionService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @ApiOperation({
    summary: 'Eliminar una extracción (administrador o gerente)',
  })
  @ApiResponse({ status: 403, description: 'Rol sin permiso' })
  @ApiParam({ name: 'id', description: 'ID de la extracción' })
  @ApiResponse({ status: 200, description: 'Extracción eliminada' })
  @ApiResponse({ status: 404, description: 'No encontrada' })
  remove(@Param('id') id: string) {
    return this.extraccionService.remove(id);
  }
}
