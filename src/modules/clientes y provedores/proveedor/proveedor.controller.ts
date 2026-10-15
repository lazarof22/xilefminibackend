import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateProveedorDto } from './dto/create-proveedor.dto';
import { UpdateProveedorDto } from './dto/update-proveedor.dto';
import { ProveedorService } from './proveedor.service';

@ApiTags('Proveedores')
@Controller('proveedores')
export class ProveedorController {
  constructor(private readonly proveedorService: ProveedorService) {}

  @ApiOperation({ summary: 'Registrar un proveedor' })
  @ApiResponse({ status: 201, description: 'Proveedor registrado' })
  @ApiResponse({ status: 400, description: 'Datos no válidos' })
  @ApiResponse({ status: 409, description: 'El código ya existe' })
  @Post()
  create(@Body() dto: CreateProveedorDto) {
    return this.proveedorService.create(dto);
  }

  @ApiOperation({ summary: 'Listar proveedores' })
  @Get()
  findAll() {
    return this.proveedorService.findAll();
  }

  @ApiOperation({ summary: 'Obtener un proveedor' })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.proveedorService.findOne(id);
  }

  @ApiOperation({ summary: 'Modificar un proveedor' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProveedorDto) {
    return this.proveedorService.update(id, dto);
  }

  @ApiOperation({ summary: 'Eliminar un proveedor' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.proveedorService.remove(id);
  }
}
