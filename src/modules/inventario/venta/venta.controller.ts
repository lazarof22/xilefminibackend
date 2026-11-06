import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ForbiddenException, Headers, Req, Res, UseGuards } from '@nestjs/common';
import { VentaService } from './venta.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { UpdateVentaDto } from './dto/update-venta.dto';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { CheckoutService } from './checkout/checkout.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ModuloApp } from '../../auth/schemas/usuarios.schema';
import type { JwtUser, RequestWithUser } from '../../auth/types/jwt-user.type';

/** Lo único que se usa de la respuesta de Express (así no se depende de sus tipos). */
interface HeaderWriter {
  setHeader(name: string, value: string): unknown;
}

/** Solo vende quien tiene habilitado el módulo de punto de venta (el administrador los tiene todos). */
function exigirPuntoDeVenta(usuario: JwtUser): void {
  if (!usuario.modulos.includes(ModuloApp.PUNTO_VENTA)) {
    throw new ForbiddenException('Su usuario no tiene acceso al punto de venta');
  }
}

@Controller('venta')
export class VentaController {
  constructor(
    private readonly ventaService: VentaService,
    private readonly checkoutService: CheckoutService,
  ) { }

  @ApiOperation({ summary: 'Registrar una nueva venta' })
  @ApiResponse({ status: 201, description: 'Venta registrada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Post()
  create(@Body() createVentaDto: CreateVentaDto) {
    return this.ventaService.create(createVentaDto);
  }

  @ApiOperation({
    summary: 'Cobrar una venta (checkout transaccional)',
    description:
      'Calcula los totales en el servidor, descuenta el stock, registra el pago, la venta, el Kardex y el Reporte Plus en una sola petición. ' +
      'Exige la cabecera Idempotency-Key (un UUID generado una sola vez por operación): repetir la petición con la misma clave devuelve la respuesta original sin vender dos veces.',
  })
  @ApiBearerAuth()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID único de la operación (8 a 128 caracteres: letras, números y . _ : -)',
  })
  @ApiResponse({ status: 201, description: 'Venta cobrada (o respuesta guardada de la misma clave; cabecera Idempotency-Replayed)' })
  @ApiResponse({ status: 400, description: 'Datos inválidos, pago insuficiente o stock insuficiente (nada queda descontado)' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Sin acceso al punto de venta o descuento por encima del permitido' })
  @ApiResponse({ status: 409, description: 'Operación en proceso, en revisión o tomada por la recuperación del servidor (reintentar con la misma clave)' })
  @ApiResponse({ status: 422, description: 'La clave ya se usó con otros datos' })
  @ApiResponse({ status: 503, description: 'Venta confirmada con pasos por registrar: se completa sola (reintentar con la misma clave)' })
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  async checkout(
    @Body() dto: CreateCheckoutDto,
    @Headers('idempotency-key') claveIdempotencia: string | undefined,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: HeaderWriter,
  ) {
    exigirPuntoDeVenta(req.user);
    const { respuesta, repetida } = await this.checkoutService.ejecutar(dto, claveIdempotencia, req.user);
    res.setHeader('Idempotency-Replayed', repetida ? 'true' : 'false');
    return respuesta;
  }

  @ApiOperation({ summary: 'Obtener todos las ventas' })
  @ApiResponse({ status: 201, description: 'Ventas obtenidas con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get()
  findAll() {
    return this.ventaService.findAll();
  }

  // Va antes de `:id` para que "parametros" no se tome como un id.
  @ApiOperation({ summary: 'Parámetros del punto de venta para el usuario: impuesto y descuento máximo' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Parámetros vigentes' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'Sin acceso al punto de venta' })
  @UseGuards(JwtAuthGuard)
  @Get('parametros')
  parametros(@Req() req: RequestWithUser) {
    exigirPuntoDeVenta(req.user);
    return this.checkoutService.parametros(req.user);
  }

  @ApiOperation({ summary: 'Obtener una venta' })
  @ApiResponse({ status: 201, description: 'Venta obtenida con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ventaService.findOne(id);
  }


  @ApiOperation({ summary: 'Modificar una venta' })
  @ApiResponse({ status: 201, description: 'VVenta modificada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateVentaDto: UpdateVentaDto) {
    return this.ventaService.update(id, updateVentaDto);
  }


  @ApiOperation({ summary: 'Eliminar una venta' })
  @ApiResponse({ status: 201, description: 'Venta eliminada con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ventaService.remove(id);
  }
}
