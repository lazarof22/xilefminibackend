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
import { BancoService } from './banco.service';
import { CreateBancoDto } from './dto/create-banco.dto';
import { UpdateBancoDto } from './dto/update-banco.dto';

@ApiTags('Banco')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('banco')
export class BancoController {
  constructor(private readonly service: BancoService) {}

  @ApiOperation({
    summary: 'Listar los bancos',
    description:
      'Cada banco trae sus prefijos de tarjeta (`prefijosTarjeta`). Con `activos=true` solo los que se pueden elegir al cobrar.',
  })
  @ApiQuery({ name: 'activos', required: false, example: 'true' })
  @Get()
  findAll(@Query('activos') activos?: string) {
    return this.service.findAll(activos === 'true');
  }

  @ApiOperation({ summary: 'Obtener un banco' })
  @ApiResponse({ status: 404, description: 'No existe' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @ApiOperation({
    summary: 'Registrar un banco',
    description:
      'Los prefijos de tarjeta son opcionales: dígitos y `?` (cualquier dígito) con los que empieza el número de la tarjeta. Ejemplos: `92250699` (prefijo corrido) o `????0699` (el segundo grupo de 4 dígitos). Solo generan un aviso al cobrar, nunca bloquean.',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un banco con ese código',
  })
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Post()
  create(@Body() dto: CreateBancoDto) {
    return this.service.create(dto);
  }

  @ApiOperation({
    summary:
      'Modificar un banco (también sus prefijos de tarjeta o desactivarlo)',
  })
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBancoDto) {
    return this.service.update(id, dto);
  }

  @ApiOperation({ summary: 'Eliminar un banco' })
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @HttpCode(204)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
