import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RegistroCompraService } from './registro-compra.service';
import { CreateRegistroCompraDto } from './dto/create-registro-compra.dto';

@ApiTags('Registro de compra')
@Controller('registro-compra')
export class RegistroCompraController {
    constructor(
        private readonly registroCompraService: RegistroCompraService,
    ) {}

    @ApiOperation({
        summary: 'Registrar una compra de inventario y su movimiento de kardex',
    })
    @ApiResponse({ status: 201, description: 'Compra registrada con éxito' })
    @ApiResponse({ status: 400, description: 'Datos inválidos' })
    @ApiResponse({ status: 404, description: 'Producto, almacén o contenedor no existe' })
    @Post()
    create(@Body() createRegistroCompraDto: CreateRegistroCompraDto) {
        return this.registroCompraService.create(createRegistroCompraDto);
    }

    @ApiOperation({ summary: 'Listar las compras registradas' })
    @ApiResponse({ status: 200, description: 'Compras obtenidas con éxito' })
    @Get()
    findAll() {
        return this.registroCompraService.findAll();
    }

    @ApiOperation({ summary: 'Obtener una compra registrada' })
    @ApiResponse({ status: 200, description: 'Compra obtenida con éxito' })
    @ApiResponse({ status: 404, description: 'No se encontró la compra' })
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.registroCompraService.findOne(id);
    }
}
