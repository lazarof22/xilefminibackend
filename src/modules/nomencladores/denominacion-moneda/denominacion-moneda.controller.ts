import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../auth/decorator/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { DenominacionMonedaService } from './denominacion-moneda.service';
import { CreateDenominacionMonedaDto } from './dto/create-denominacion-moneda.dto';
import { UpdateDenominacionMonedaDto } from './dto/update-denominacion-moneda.dto';

@ApiTags('Denominación de moneda')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('denominacion-moneda')
export class DenominacionMonedaController {
  constructor(private readonly service: DenominacionMonedaService) {}

  @ApiOperation({
    summary: 'Listar los billetes y monedas de cada moneda',
    description:
      'Con `moneda` (CUP, USD, EUR...) devuelve solo las de esa moneda. Del mayor al menor valor.',
  })
  @ApiQuery({ name: 'moneda', required: false, example: 'USD' })
  @Get()
  findAll(@Query('moneda') moneda?: string) {
    return this.service.findAll(moneda);
  }

  @ApiOperation({ summary: 'Obtener una denominación' })
  @ApiResponse({ status: 404, description: 'No existe' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @ApiOperation({ summary: 'Añadir un billete o moneda a una moneda' })
  @ApiResponse({ status: 409, description: 'Ya existe esa denominación' })
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Post()
  create(@Body() dto: CreateDenominacionMonedaDto) {
    return this.service.create(dto);
  }

  @ApiOperation({
    summary: 'Modificar o desactivar una denominación',
    description:
      'Con `activa: false` deja de ofrecerse y de aceptarse en los cobros nuevos; los pagos anteriores no cambian.',
  })
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDenominacionMonedaDto) {
    return this.service.update(id, dto);
  }

  @ApiOperation({ summary: 'Eliminar una denominación' })
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @HttpCode(204)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
