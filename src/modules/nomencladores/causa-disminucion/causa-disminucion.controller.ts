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
import { CausaDisminucionService } from './causa-disminucion.service';
import { CreateCausaDisminucionDto } from './dto/create-causa-disminucion.dto';
import { UpdateCausaDisminucionDto } from './dto/update-causa-disminucion.dto';

@ApiTags('Causas de disminución')
@Controller('causa-disminucion')
export class CausaDisminucionController {
  constructor(private readonly causaService: CausaDisminucionService) {}

  @ApiOperation({ summary: 'Registrar una causa de disminución de inventario' })
  @ApiResponse({ status: 201, description: 'Causa registrada' })
  @ApiResponse({ status: 400, description: 'Nombre vacío o ya existe' })
  @Post()
  create(@Body() dto: CreateCausaDisminucionDto) {
    return this.causaService.create(dto);
  }

  @ApiOperation({
    summary: 'Listar las causas de disminución (orden alfabético)',
  })
  @Get()
  findAll() {
    return this.causaService.findAll();
  }

  @ApiOperation({ summary: 'Obtener una causa de disminución' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.causaService.findOne(id);
  }

  @ApiOperation({ summary: 'Modificar una causa de disminución' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCausaDisminucionDto) {
    return this.causaService.update(id, dto);
  }

  @ApiOperation({ summary: 'Eliminar una causa de disminución' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.causaService.remove(id);
  }
}
