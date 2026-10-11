import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReporteInventarioService } from './reporte-inventario.service';
import { ReporteInventarioItemDto } from './dto/reporte-inventario-item.dto';

@ApiTags('Reporte de inventario')
@Controller('inventario')
export class ReporteInventarioController {
  constructor(
    private readonly reporteInventarioService: ReporteInventarioService,
  ) {}

  @ApiOperation({
    summary:
      'Reporte de inventario: por producto, disponibles, reservados e inventario total (disponibles − reservados)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reporte obtenido con éxito',
    type: [ReporteInventarioItemDto],
  })
  @Get('reporte')
  obtenerReporte(): Promise<ReporteInventarioItemDto[]> {
    return this.reporteInventarioService.obtenerReporte();
  }
}
