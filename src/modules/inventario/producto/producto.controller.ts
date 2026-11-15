import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorator/roles.decorator';
import { ProductoService } from './producto.service';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';

/** §6.9 "cambio de precio": solo el administrador y el gerente. */
const ROLES_CAMBIO_DE_PRECIO: readonly string[] = [
  UsuarioRol.ADMIN,
  UsuarioRol.GERENTE,
];

/** Campos que solo cambian el administrador y el gerente, con el mensaje del 403. */
const CAMPOS_RESERVADOS = [
  {
    campo: 'precio_venta',
    mensaje:
      'Solo el administrador o el gerente pueden cambiar el precio de venta',
  },
  {
    campo: 'precio_compra',
    mensaje:
      'Solo el administrador o el gerente pueden cambiar el costo del producto',
  },
  {
    campo: 'stock_inicial',
    mensaje:
      'Solo el administrador o el gerente pueden cambiar el stock; use un ajuste de inventario',
  },
] as const;

@ApiTags('Producto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('producto')
export class ProductoController {
  constructor(private readonly productoService: ProductoService) {}

  @ApiOperation({ summary: 'Registrar un nuevo Producto' })
  @ApiResponse({ status: 201, description: 'Producto registrado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Post()
  create(@Body() createProductoDto: CreateProductoDto) {
    return this.productoService.create(createProductoDto);
  }

  @ApiOperation({ summary: 'Obtener todos los productos' })
  @ApiResponse({ status: 201, description: 'Productos obtenidos con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get()
  findAll() {
    return this.productoService.findAll();
  }

  @ApiOperation({ summary: 'Obtener un producto' })
  @ApiResponse({ status: 201, description: 'Producto obtenido con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productoService.findOne(id);
  }

  @ApiOperation({ summary: 'Modificar un producto' })
  @ApiResponse({ status: 201, description: 'Producto modificado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({
    status: 403,
    description:
      'Solo el administrador o el gerente pueden cambiar el precio de venta',
  })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateProductoDto: UpdateProductoDto,
    @Req() req: RequestWithUser,
  ) {
    await this.exigirPermisoDePrecio(id, updateProductoDto, req.user.rol);
    return this.productoService.update(id, updateProductoDto);
  }

  /**
   * Cambiar el precio de venta, el costo o el stock de un producto es cosa del
   * administrador y el gerente (el stock se corrige con un ajuste de inventario
   * con causa, §9). Solo cuenta como cambio si el valor enviado difiere del
   * guardado: reenviar la ficha completa sin tocarlos no se bloquea.
   */
  private async exigirPermisoDePrecio(
    id: string,
    dto: UpdateProductoDto,
    rol: string,
  ): Promise<void> {
    const enviados = CAMPOS_RESERVADOS.filter(
      (c) => dto[c.campo] !== undefined,
    );
    if (enviados.length === 0 || ROLES_CAMBIO_DE_PRECIO.includes(rol)) {
      return;
    }

    const actual = await this.productoService.findOne(id);

    for (const { campo, mensaje } of enviados) {
      // `!(… <= tolerancia)` so a NaN value is refused instead of slipping through.
      if (!(Math.abs(Number(actual[campo]) - Number(dto[campo])) <= 1e-9)) {
        throw new ForbiddenException(mensaje);
      }
    }
  }

  @ApiOperation({ summary: 'Asignar un contenedor a un producto' })
  @ApiResponse({ status: 201, description: 'Contenedor asignado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Patch(':id/asignar-contenedor')
  asignarContenedor(
    @Param('id') id: string,
    @Body('contenedor') contenedor: string,
  ) {
    return this.productoService.asignarContenedor(id, contenedor);
  }

  @ApiOperation({ summary: 'Eliminar un producto' })
  @ApiResponse({ status: 201, description: 'Producto eliminado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @UseGuards(RolesGuard)
  @Roles(UsuarioRol.ADMIN, UsuarioRol.GERENTE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productoService.remove(id);
  }
}
