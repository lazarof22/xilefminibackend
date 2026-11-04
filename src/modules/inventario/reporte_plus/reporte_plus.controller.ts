import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { ReportePlusService } from './reporte_plus.service';

/** Cerrar turno: Cajero y Administrador (doc §6.9). */
export const ROLES_CERRAR_TURNO = [UsuarioRol.CAJERO, UsuarioRol.ADMIN];

@ApiTags('Reporte Plus')
@ApiBearerAuth()
@Controller('reporte-plus')
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @ApiResponse({ status: 403, description: 'Rol sin permiso para cerrar turno' })
  @Roles(...ROLES_CERRAR_TURNO)
  @HttpCode(HttpStatus.OK)
  @Post('cerrar-turno')
  cerrarTurno() {
    return this.reportePlusService.cerrarTurno();
  }
}
