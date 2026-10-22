import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReportePlusService } from './reporte_plus.service';

@ApiTags('Reporte Plus')
@Controller('reporte-plus')
export class ReportePlusController {
  constructor(private readonly reportePlusService: ReportePlusService) {}

  @ApiOperation({ summary: 'Ventas del turno actual (una fila por producto)' })
  @ApiResponse({ status: 200, description: 'Listado del turno' })
  @Get()
  findAll() {
    return this.reportePlusService.findAll();
  }

  @ApiOperation({
    summary:
      'Totales del turno: ventas, extracciones, saldo neto, transferencias y desglose por método de pago',
  })
  @Get('resumen')
  resumen() {
    return this.reportePlusService.resumen();
  }

  @ApiOperation({
    summary:
      'Cerrar turno: registra los movimientos en el Kardex y limpia el reporte',
  })
  @ApiResponse({ status: 200, description: 'Turno cerrado' })
  @ApiResponse({ status: 400, description: 'No hay ventas para cerrar' })
  @HttpCode(HttpStatus.OK)
  @Post('cerrar-turno')
  cerrarTurno() {
    return this.reportePlusService.cerrarTurno();
  }
}
