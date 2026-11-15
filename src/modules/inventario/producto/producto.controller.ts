import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req, ForbiddenException } from '@nestjs/common';
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
const ROLES_CAMBIO_DE_PRECIO: readonly string[] = [UsuarioRol.ADMIN, UsuarioRol.GERENTE];


@ApiTags('Producto')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('producto')
export class ProductoController {
  constructor(private readonly productoService: ProductoService) { }

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
  @ApiResponse({ status: 403, description: 'Solo el administrador o el gerente pueden cambiar el precio de venta' })
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
   * Cambiar el precio de venta es cosa del administrador y el gerente. Solo
   * cuenta como cambio si el valor enviado difiere del guardado: reenviar el
   * mismo precio (la pantalla suele mandar la ficha completa) no se bloquea.
   */
  private async exigirPermisoDePrecio(
    id: string,
    dto: UpdateProductoDto,
    rol: string,
  ): Promise<void> {
    if (dto.precio_venta === undefined || ROLES_CAMBIO_DE_PRECIO.includes(rol)) {
      return;
    }

    const actual = await this.productoService.findOne(id);

    if (Math.abs(Number(actual.precio_venta) - Number(dto.precio_venta)) > 1e-9) {
      throw new ForbiddenException(
        'Solo el administrador o el gerente pueden cambiar el precio de venta',
      );
    }
  }

  @ApiOperation({ summary: 'Asignar un contenedor a un producto' })
  @ApiResponse({ status: 201, description: 'Contenedor asignado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Patch(':id/asignar-contenedor')
  asignarContenedor(@Param('id') id: string, @Body('contenedor') contenedor: string) {
    return this.productoService.asignarContenedor(id, contenedor);
  }

  @ApiOperation({ summary: 'Eliminar un producto' })
  @ApiResponse({ status: 201, description: 'Producto eliminado con exito' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productoService.remove(id);
  }
}
