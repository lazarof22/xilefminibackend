import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from './decorator/roles.decorator';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import type { RequestWithUser } from './types/jwt-user.type';
import { UsuarioRol } from './schemas/usuarios.schema';
import { UsuariosService } from './usuarios.service';
import type { UsuarioListado } from './usuarios.service';

@ApiTags('Usuarios')
@ApiBearerAuth()
@Controller('usuarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UsuarioRol.ADMIN)
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios (admin)' })
  findAll(): Promise<UsuarioListado[]> {
    return this.usuariosService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un usuario con su rol y módulos (admin)' })
  @ApiResponse({ status: 201, description: 'Usuario creado' })
  @ApiResponse({ status: 409, description: 'El nombre ya existe' })
  create(@Body() dto: CreateUsuarioDto): Promise<UsuarioListado> {
    return this.usuariosService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Cambiar rol, módulos, nombre o contraseña (admin)',
  })
  @ApiParam({ name: 'id' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUsuarioDto,
  ): Promise<UsuarioListado> {
    return this.usuariosService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un usuario (admin)' })
  @ApiParam({ name: 'id' })
  remove(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
  ): Promise<{ deleted: boolean }> {
    return this.usuariosService.remove(id, req.user.userId);
  }
}
