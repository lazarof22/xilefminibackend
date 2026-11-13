import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorator/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsuarioRol } from '../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../auth/types/jwt-user.type';
import { ConfiguracionPagosService } from './configuracion-pagos.service';
import { UpdateConfiguracionPagosDto } from './dto/update-configuracion-pagos.dto';

@ApiTags('Configuración de pagos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('configuracion-pagos')
export class ConfiguracionPagosController {
  constructor(private readonly service: ConfiguracionPagosService) {}

  @ApiOperation({ summary: 'Parámetros de cobro vigentes (tipo de tasa)' })
  @Get()
  obtener() {
    return this.service.obtener();
  }

  @ApiOperation({
    summary: 'Elegir qué tasa se usa para cobrar en otras monedas',
    description:
      '`tasaMercadoInformal` (por defecto) o `tasaBancoCentral`. Se aplica a los cobros nuevos; cada pago guarda la tasa que usó.',
  })
  @ApiResponse({ status: 400, description: 'Tipo de tasa no válido' })
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Patch()
  actualizar(
    @Body() dto: UpdateConfiguracionPagosDto,
    @Req() req: RequestWithUser,
  ) {
    return this.service.actualizar(dto, req.user.nombre);
  }
}
