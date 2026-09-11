import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ComprobanteTipoService } from './comprobante-tipo.service';
import { CreateComprobanteTipoDto } from './dto/create-comprobante-tipo.dto';
import { UpdateComprobanteTipoDto } from './dto/update-comprobante-tipo.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';

@ApiTags('Tipos de Comprobante')
@Controller('comprobante-tipo')
export class ComprobanteTipoController {
  constructor(
    private readonly comprobanteTipoService: ComprobanteTipoService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Registrar un nuevo tipo de comprobante' })
  @ApiResponse({
    status: 201,
    description: 'Tipo de comprobante registrado',
  })
  @ApiResponse({ status: 400, description: 'Código duplicado' })
  create(@Body() createDto: CreateComprobanteTipoDto) {
    return this.comprobanteTipoService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los tipos de comprobante' })
  @ApiResponse({ status: 200, description: 'Lista de tipos de comprobante' })
  findAll() {
    return this.comprobanteTipoService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un tipo de comprobante por ID' })
  @ApiParam({ name: 'id', description: 'ID del tipo de comprobante' })
  @ApiResponse({
    status: 200,
    description: 'Tipo de comprobante encontrado',
  })
  @ApiResponse({
    status: 404,
    description: 'Tipo de comprobante no encontrado',
  })
  findOne(@Param('id') id: string) {
    return this.comprobanteTipoService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un tipo de comprobante' })
  @ApiParam({ name: 'id', description: 'ID del tipo de comprobante' })
  @ApiResponse({
    status: 200,
    description: 'Tipo de comprobante actualizado',
  })
  @ApiResponse({
    status: 404,
    description: 'Tipo de comprobante no encontrado',
  })
  update(@Param('id') id: string, @Body() updateDto: UpdateComprobanteTipoDto) {
    return this.comprobanteTipoService.update(id, updateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un tipo de comprobante' })
  @ApiParam({ name: 'id', description: 'ID del tipo de comprobante' })
  @ApiResponse({
    status: 200,
    description: 'Tipo de comprobante eliminado',
  })
  @ApiResponse({
    status: 404,
    description: 'Tipo de comprobante no encontrado',
  })
  remove(@Param('id') id: string) {
    return this.comprobanteTipoService.remove(id);
  }
}