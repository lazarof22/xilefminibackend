import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RegistroCompraService } from './registro-compra.service';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('Registro de compra')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('registro-compra')
export class RegistroCompraController {
    constructor(
        private readonly registroCompraService: RegistroCompraService,
    ) {}

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
