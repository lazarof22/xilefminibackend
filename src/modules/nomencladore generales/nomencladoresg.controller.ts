import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Query,
} from '@nestjs/common';

import { NomencladoresService } from './nomencladoresg.service';

import { CrearNomencladorDto } from './dto/crear_nomenclador.dto';
import { ActualizarNomencladorDto } from './dto/actualizar_nomenclador.dto';
import { CambiarEstadoDto } from './dto/cambiar_estado.dto';
import { CrearValorNomencladorDto } from './dto/crear_valor_nomenclador.dto';
import { ActualizarValorNomencladorDto } from './dto/actualizar_valor_nomenclador.dto';

@Controller('nomencladores')
export class NomencladoresController {
  constructor(
    private readonly nomencladoresService: NomencladoresService,
  ) {}

  // ============================================================
  // NOMENCLADORES
  // ============================================================

  @Get()
  listarNomencladores() {
    return this.nomencladoresService.listarNomencladores();
  }

  @Get('id/:id')
  obtenerNomencladorPorId(@Param('id') id: string) {
    return this.nomencladoresService.obtenerNomencladorPorId(id);
  }

  @Get('codigo/:codigo')
  obtenerNomencladorPorCodigo(
    @Param('codigo') codigo: string,
  ) {
    return this.nomencladoresService.obtenerNomencladorPorCodigo(
      codigo,
    );
  }

  @Post()
  crearNomenclador(@Body() dto: CrearNomencladorDto) {
    return this.nomencladoresService.crearNomenclador(dto);
  }

  @Patch(':id')
  actualizarNomenclador(
    @Param('id') id: string,
    @Body() dto: ActualizarNomencladorDto,
  ) {
    return this.nomencladoresService.actualizarNomenclador(
      id,
      dto,
    );
  }

  @Patch(':id/estado')
  cambiarEstadoNomenclador(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDto,
  ) {
    return this.nomencladoresService.cambiarEstadoNomenclador(
      id,
      dto.activo,
    );
  }

  // ============================================================
  // VALORES
  // ============================================================

  @Get(':codigo/valores')
  listarValoresActivos(
    @Param('codigo') codigo: string,
  ) {
    return this.nomencladoresService.listarValores(
      codigo,
      false,
    );
  }

  @Get(':codigo/valores/todos')
  listarTodosLosValores(
    @Param('codigo') codigo: string,
  ) {
    return this.nomencladoresService.listarValores(
      codigo,
      true,
    );
  }

  @Get('valores/id/:id')
  obtenerValorPorId(@Param('id') id: string) {
    return this.nomencladoresService.obtenerValorPorId(id);
  }

  @Post(':codigo/valores')
  crearValor(
    @Param('codigo') codigo: string,
    @Body() dto: CrearValorNomencladorDto,
  ) {
    return this.nomencladoresService.crearValor(
      codigo,
      dto,
    );
  }

  @Patch('valores/:id')
  actualizarValor(
    @Param('id') id: string,
    @Body() dto: ActualizarValorNomencladorDto,
  ) {
    return this.nomencladoresService.actualizarValor(
      id,
      dto,
    );
  }

  @Patch('valores/:id/estado')
  cambiarEstadoValor(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDto,
  ) {
    return this.nomencladoresService.cambiarEstadoValor(
      id,
      dto.activo,
    );
  }

  @Delete('valores/:id')
  eliminarValor(@Param('id') id: string) {
    return this.nomencladoresService.eliminarValor(id);
  }
}