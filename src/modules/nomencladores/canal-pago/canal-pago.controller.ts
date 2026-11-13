import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CANALES_PAGO } from './canal-pago.catalogo';

@ApiTags('Canal de pago')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('canal-pago')
export class CanalPagoController {
  @ApiOperation({
    summary: 'Canales de transferencia disponibles',
    description:
      'Banco, Transfermóvil, EnZona y Zelle. Zelle es un canal de pago, no una moneda: se paga en USD. `requiereBanco` indica si el cobro debe llevar un banco del nomenclador.',
  })
  @Get()
  listar() {
    return CANALES_PAGO;
  }
}
