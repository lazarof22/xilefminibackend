import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { KardexService } from './kardex.service';
import { CreateKardexDto } from './dto/create-kardex.dto';
import { UpdateKardexDto } from './dto/update-kardex.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';

/** Crear, modificar y eliminar movimientos de kardex. */
export const ROLES_ESCRIBIR_KARDEX = [UsuarioRol.ADMIN, UsuarioRol.ECONOMICO];

@ApiTags()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kardex')
export class KardexController {
  constructor(private readonly kardexService: KardexService) { }

  @ApiOperation({ summary: 'Registrar un nuevo Kardex' })
  @ApiResponse({ status: 201, description: 'Kardex registrado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Post()
  @Roles(...ROLES_ESCRIBIR_KARDEX)
  create(@Body() createKardexDto: CreateKardexDto) {
    return this.kardexService.create(createKardexDto);
  }


  @ApiOperation({ summary: 'Obtener todos los kardex' })
  @ApiResponse({ status: 201, description: 'Kardex obtenidos con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get()
  findAll() {
    return this.kardexService.findAll();
  }


  @ApiOperation({ summary: 'Obtener todos los kardex de tipo salida' })
  @ApiResponse({ status: 201, description: 'Kardex obtenidos con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get('salidas')
  async findAllSalidas(){
    return this.kardexService.findAllSalidas();
  }


  @ApiOperation({ summary: 'Obtener un kardex' })
  @ApiResponse({ status: 201, description: 'Kardex obtenido con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.kardexService.findOne(id);
  }

  @ApiOperation({ summary: 'Modificar un kardex' })
  @ApiResponse({ status: 201, description: 'Kardex modificado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Patch(':id')
  @Roles(...ROLES_ESCRIBIR_KARDEX)
  update(@Param('id') id: string, @Body() updateKardexDto: UpdateKardexDto) {
    return this.kardexService.update(id, updateKardexDto);
  }

  @ApiOperation({ summary: 'Eliminar un kardex' })
  @ApiResponse({ status: 201, description: 'Kardex eliminado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Delete(':id')
  @Roles(...ROLES_ESCRIBIR_KARDEX)
  remove(@Param('id') id: string) {
    return this.kardexService.remove(id);
  }
}
