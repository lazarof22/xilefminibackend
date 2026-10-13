import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CiudadService } from './ciudad.service';
import { CreateCiudadDto } from './dto/create-ciudad.dto';
import { UpdateCiudadDto } from './dto/update-ciudad.dto';

@ApiTags('Ciudad')
@Controller('ciudad')
export class CiudadController {
  constructor(private readonly ciudadService: CiudadService) {}

  @ApiOperation({ summary: 'Registrar una nueva ciudad asociada a un país' })
  @ApiResponse({ status: 201, description: 'Ciudad registrada con éxito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Post()
  create(@Body() createCiudadDto: CreateCiudadDto) {
    return this.ciudadService.create(createCiudadDto);
  }

  @ApiOperation({
    summary: 'Obtener las ciudades (opcionalmente filtradas por país)',
  })
  @ApiQuery({ name: 'pais', required: false, description: 'ObjectId del país' })
  @ApiResponse({ status: 200, description: 'Ciudades obtenidas con éxito' })
  @Get()
  findAll(@Query('pais') pais?: string) {
    return this.ciudadService.findAll(pais);
  }

  @ApiOperation({ summary: 'Obtener una ciudad' })
  @ApiResponse({ status: 200, description: 'Ciudad obtenida con éxito' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ciudadService.findOne(id);
  }

  @ApiOperation({ summary: 'Modificar una ciudad' })
  @ApiResponse({ status: 200, description: 'Ciudad modificada con éxito' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCiudadDto: UpdateCiudadDto) {
    return this.ciudadService.update(id, updateCiudadDto);
  }

  @ApiOperation({ summary: 'Eliminar una ciudad' })
  @ApiResponse({ status: 200, description: 'Ciudad eliminada con éxito' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ciudadService.remove(id);
  }
}
