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
      'Resumen del turno: efectivo esperado, cuentas por cobrar y cobros electrónicos POR SEPARADO y por moneda',
    description:
      'Efectivo esperado = fondo inicial + efectivo recibido - cambio - devoluciones en efectivo - extracciones - depósitos bancarios. ' +
      'Una venta a crédito no altera el efectivo esperado; "factura" no es un medio de cobro y se informa aparte (`facturado`). ' +
      'Campo OBSOLETO: `saldoNeto` (mezclaba efectivo, crédito y transferencia); se conserva solo por compatibilidad.',
  })
  @ApiResponse({
    status: 200,
    description:
      '{ efectivoEsperado, cuentasPorCobrar, cobrosElectronicos, facturado, detalleEfectivo (por moneda), totalVentas, totalExtracciones, porMetodo, cantidadTransferencias, movimientos, saldoNeto (obsoleto) }',
  })
  @Get('resumen')
  resumen() {
    return this.reportePlusService.resumen();
  }

  @ApiOperation({
    summary:
      'Cerrar turno: registra los movimientos en el Kardex, archiva las líneas del turno y limpia el reporte',
  })
  @ApiResponse({ status: 200, description: 'Turno cerrado' })
  @ApiResponse({ status: 400, description: 'No hay ventas para cerrar' })
  @HttpCode(HttpStatus.OK)
  @Post('cerrar-turno')
  cerrarTurno() {
    return this.reportePlusService.cerrarTurno();
  }
}
