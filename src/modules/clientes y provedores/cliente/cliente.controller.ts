import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ClienteService } from './cliente.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';


/**
 * A discount client gets an automatic discount on every sale that the
 * cashier cannot grant by hand (doc 6.9, "Descuento manual"): creating or
 * editing that condition is for administrador and gerente.
 */
const ROLES_CONDICION_DESCUENTO: string[] = [UsuarioRol.ADMIN, UsuarioRol.GERENTE];

function exigirSupervisorParaDescuento(
  dto: { tipo_cliente?: string; descuentoPct?: number },
  rol: string,
): void {
  const tocaDescuento =
    dto.tipo_cliente === 'cliente_descuento' || dto.descuentoPct !== undefined;
  if (tocaDescuento && !ROLES_CONDICION_DESCUENTO.includes(rol)) {
    throw new ForbiddenException(
      'Solo el administrador o el gerente pueden asignar el descuento de un cliente',
    );
  }
}

@ApiTags('Cliente')
@UseGuards(JwtAuthGuard)
@Controller('cliente')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) { }


  @ApiOperation({ summary: 'Registrar un nuevo cliente' })
  @ApiResponse({ status: 201, description: 'Cliente registrado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Post()
  create(
    @Body() createClienteDto: CreateClienteDto,
    @Req() req: RequestWithUser,
  ) {
    exigirSupervisorParaDescuento(createClienteDto, req.user.rol);
    return this.clienteService.create(createClienteDto);
  }

  @ApiOperation({ summary: 'Obtener todos los clientes' })
  @ApiResponse({ status: 201, description: 'Clientes obtenidos con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get()
  findAll() {
    return this.clienteService.findAll();
  }

  @ApiOperation({ summary: 'Obtener un cliente' })
  @ApiResponse({ status: 201, description: 'Cliente obtenido con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clienteService.findOne(id);
  }

  @ApiOperation({ summary: 'Modificar un cliente' })
  @ApiResponse({ status: 201, description: 'Cliente modificado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() UpdateClienteDto: UpdateClienteDto,
    @Req() req: RequestWithUser,
  ) {
    exigirSupervisorParaDescuento(UpdateClienteDto, req.user.rol);
    return this.clienteService.update(id, UpdateClienteDto);
  }

  @ApiOperation({ summary: 'Eliminar un cliente' })
  @ApiResponse({ status: 201, description: 'Cliente eliminado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @UseGuards(RolesGuard)
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clienteService.remove(id);
  }
}
