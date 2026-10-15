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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IpvService } from './ipv.service';
import { GuardarIpvDto } from './dto/guardar-ipv.dto';
import { UpdateIpvDto } from './dto/update-ipv.dto';
import { ResetIpvDto } from './dto/reset-ipv.dto';

@ApiTags('IPV')
@Controller('ipv')
export class IpvController {
  constructor(private readonly ipvService: IpvService) {}

  @ApiOperation({ summary: 'IPV del día (guardado o precargado)' })
  @ApiQuery({ name: 'fecha', required: false, example: '2026-10-14' })
  @Get()
  obtenerDia(@Query('fecha') fecha?: string) {
    return this.ipvService.obtenerDia(fecha);
  }

  @ApiOperation({ summary: 'Días con IPV guardado' })
  @Get('fechas')
  listarFechas() {
    return this.ipvService.listarFechas();
  }

  @ApiOperation({ summary: 'Guardar (crear o actualizar) el IPV de un día' })
  @Post()
  guardar(@Body() dto: GuardarIpvDto) {
    return this.ipvService.guardar(dto);
  }

  @ApiOperation({ summary: 'Eliminar el IPV guardado de un día' })
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset(@Body() dto: ResetIpvDto) {
    return this.ipvService.reset(dto.fecha);
  }

  @ApiOperation({ summary: 'Actualizar una fila del IPV' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIpvDto) {
    return this.ipvService.update(id, dto);
  }

  @ApiOperation({ summary: 'Eliminar una fila del IPV' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.ipvService.remove(id);
  }
}
