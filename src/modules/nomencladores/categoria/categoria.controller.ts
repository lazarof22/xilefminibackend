import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { CategoriaService } from './categoria.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('Categoria')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('categoria')
export class CategoriaController {
  constructor(private readonly categoriaService: CategoriaService) { }

  @ApiOperation({ summary: 'Registrar una nueva categoria' })
  @ApiResponse({ status: 201, description: 'Categoria registrada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Post()
  create(@Body() createCategoriaDto: CreateCategoriaDto) {
    return this.categoriaService.create(createCategoriaDto);
  }

  @ApiOperation({ summary: 'Obtener todas las categorias' })
  @ApiResponse({ status: 201, description: 'Categorias obtenidas con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get()
  findAll() {
    return this.categoriaService.findAll();
  }

  @ApiOperation({ summary: 'Obtener todas las categorias' })
  @ApiResponse({ status: 201, description: 'Categorias obtenidas con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriaService.findOne(id);
  }



  @ApiOperation({ summary: 'Modificar una categoria' })
  @ApiResponse({ status: 201, description: 'Categoria modificada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCategoriaDto: UpdateCategoriaDto) {
    return this.categoriaService.update(id, updateCategoriaDto);
  }

  @ApiOperation({ summary: 'Eliminar una categoria' })
  @ApiResponse({ status: 201, description: 'Categoria eliminada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @UseGuards(RolesGuard)
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoriaService.remove(id);
  }
}
