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
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import { TasaService } from "./tasa.service";
import { CreateTasaDto } from "./dto/create-tasa.dto";
import { UpdateTasaDto } from "./dto/update-tasa.dto";

@ApiTags("Tasas")
@Controller("tasas")
export class TasaController {
  constructor(
    private readonly tasaService: TasaService,
  ) {}

  @Post()
  @ApiOperation({
    summary: "Crear una tasa de cambio",
    description:
      "Crea una tasa para una moneda activa registrada en el nomenclador MONEDA.",
  })
  @ApiBody({ type: CreateTasaDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "Tasa creada correctamente.",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      "Datos inválidos o la moneda no existe/no está activa en el nomenclador MONEDA.",
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: "Ya existe una tasa para la moneda.",
  })
  create(@Body() createTasaDto: CreateTasaDto) {
    return this.tasaService.create(createTasaDto);
  }

  @Get()
  @ApiOperation({
    summary: "Listar todas las tasas",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Listado de tasas obtenido correctamente.",
  })
  findAll() {
    return this.tasaService.findAll();
  }

  /*
   * Debe declararse antes de @Get(':id'), para que Nest no interprete
   * la ruta 'moneda/USD' como si 'moneda' fuera un id.
   */
  @Get("moneda/:moneda")
  @ApiOperation({
    summary: "Obtener una tasa por código de moneda",
  })
  @ApiParam({
    name: "moneda",
    description:
      "Código de moneda configurado en el nomenclador MONEDA.",
    example: "USD",
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Tasa encontrada correctamente.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "No existe una tasa para la moneda indicada.",
  })
  findByMoneda(@Param("moneda") moneda: string) {
    return this.tasaService.findByMoneda(moneda);
  }

  @Patch("moneda/:moneda")
  @ApiOperation({
    summary: "Crear o actualizar una tasa por código de moneda",
    description:
      "Solo permite monedas activas incluidas en el nomenclador MONEDA.",
  })
  @ApiParam({
    name: "moneda",
    description:
      "Código de la moneda configurado en el nomenclador MONEDA.",
    example: "USD",
    type: String,
  })
  @ApiBody({ type: UpdateTasaDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Tasa creada o actualizada correctamente.",
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      "La moneda no existe o está inactiva en el nomenclador MONEDA.",
  })
  upsertByMoneda(
    @Param("moneda") moneda: string,
    @Body() updateTasaDto: UpdateTasaDto,
  ) {
    return this.tasaService.upsertByMoneda(
      moneda,
      updateTasaDto,
    );
  }

  @Get(":id")
  @ApiOperation({
    summary: "Obtener una tasa por identificador",
  })
  @ApiParam({
    name: "id",
    description: "Identificador MongoDB de la tasa.",
    example: "66f100000000000000000101",
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Tasa encontrada correctamente.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "No existe una tasa con el identificador indicado.",
  })
  findOne(@Param("id") id: string) {
    return this.tasaService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Actualizar una tasa por identificador",
  })
  @ApiParam({
    name: "id",
    description: "Identificador MongoDB de la tasa.",
    example: "66f100000000000000000101",
    type: String,
  })
  @ApiBody({ type: UpdateTasaDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Tasa actualizada correctamente.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "No existe una tasa con el identificador indicado.",
  })
  update(
    @Param("id") id: string,
    @Body() updateTasaDto: UpdateTasaDto,
  ) {
    return this.tasaService.update(id, updateTasaDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Eliminar una tasa por identificador",
  })
  @ApiParam({
    name: "id",
    description: "Identificador MongoDB de la tasa.",
    example: "66f100000000000000000101",
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: "Tasa eliminada correctamente.",
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: "No existe una tasa con el identificador indicado.",
  })
  remove(@Param("id") id: string) {
    return this.tasaService.remove(id);
  }
}