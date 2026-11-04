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
import { CuadreCajaService } from './cuadre_caja.service';
import { CreateCuadreCajaDto } from './dto/create-cuadre_caja.dto';
import { UpdateCuadreCajaDto } from './dto/update-cuadre_caja.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('Cuadre Caja')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cuadre-caja')
export class CuadreCajaController {
  constructor(private readonly cuadreCajaService: CuadreCajaService) {}

  @ApiOperation({
    summary:
      'Registrar un nuevo cuadre de caja (vinculado al turno abierto del cajero; compara solo contra el efectivo esperado de su moneda)',
  })
  @ApiResponse({
    status: 201,
    description: 'Cuadre de caja registrado con exito',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Post()
  create(@Body() createCuadreCajaDto: CreateCuadreCajaDto) {
    return this.cuadreCajaService.create(createCuadreCajaDto);
  }

  @ApiOperation({ summary: 'Obtener todos los cuadres de caja' })
  @ApiResponse({ status: 201, description: 'Cuadres obtenidos con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiQuery({
    name: 'fecha',
    required: false,
    description: 'Filtrar por fecha (YYYY-MM-DD)',
  })
  @Get()
  findAll(@Query('fecha') fecha?: string) {
    return this.cuadreCajaService.findAll(fecha);
  }

  @ApiOperation({
    summary: 'Obtener resumen diario de ventas para precargar el cuadre',
  })
  @ApiResponse({ status: 200, description: 'Resumen obtenido con exito' })
  @ApiQuery({
    name: 'fecha',
    required: false,
    description: 'Fecha en formato YYYY-MM-DD (por defecto hoy)',
  })
  @ApiQuery({
    name: 'empleado',
    required: false,
    description:
      'ID del cajero: si tiene turno abierto se informan su fondo inicial y depósitos',
  })
  @ApiQuery({
    name: 'moneda',
    required: false,
    description: 'Código de moneda de las cifras (CUP por defecto)',
  })
  @Get('resumen-diario')
  getResumenDiario(
    @Query('fecha') fecha?: string,
    @Query('empleado') empleado?: string,
    @Query('moneda') moneda?: string,
  ) {
    return this.cuadreCajaService.getResumenDiario(fecha, empleado, moneda);
  }

  @ApiOperation({
    summary: 'Obtener el monto total de ventas del día',
  })
  @ApiResponse({ status: 200, description: 'Total obtenido con exito' })
  @ApiQuery({
    name: 'fecha',
    required: false,
    description: 'Fecha en formato YYYY-MM-DD (por defecto hoy)',
  })
  @Get('total-dia')
  getTotalDia(@Query('fecha') fecha?: string) {
    return this.cuadreCajaService.getTotalDia(fecha);
  }

  @ApiOperation({ summary: 'Obtener un cuadre de caja' })
  @ApiResponse({ status: 201, description: 'Cuadre obtenido con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cuadreCajaService.findOne(id);
  }

  @ApiOperation({ summary: 'Modificar un cuadre de caja' })
  @ApiResponse({ status: 201, description: 'Cuadre modificado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCuadreCajaDto: UpdateCuadreCajaDto,
  ) {
    return this.cuadreCajaService.update(id, updateCuadreCajaDto);
  }

  @ApiOperation({ summary: 'Eliminar un cuadre de caja' })
  @ApiResponse({ status: 201, description: 'Cuadre eliminado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cuadreCajaService.remove(id);
  }
}
