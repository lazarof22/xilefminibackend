import {
    Controller,
    Get,
    Param,
} from '@nestjs/common';
import {
    ApiOperation,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';

import { ExistenciaService } from './existencia.service';
import { UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('Existencias')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('existencias')
export class ExistenciaController {
    constructor(
        private readonly existenciaService: ExistenciaService,
    ) {}

    @ApiOperation({
        summary:
            'Obtener las ubicaciones disponibles de un producto',
    })
    @ApiResponse({
        status: 200,
        description:
            'Lista de almacenes y contenedores donde existe el producto',
    })
    @Get('producto/:productoId')
    listarPorProducto(
        @Param('productoId') productoId: string,
    ) {
        return this.existenciaService.listarPorProducto(
            productoId,
        );
    }

    @ApiOperation({
        summary:
            'Indica si el inventario ya usa las existencias por ubicación como saldo único',
    })
    @ApiResponse({
        status: 200,
        description: '{ unificado, unificadoEn }',
    })
    @Get('estado')
    async obtenerEstado() {
        const { unificado, unificadoEn } =
            await this.existenciaService.obtenerEstadoUnificacion();

        return { unificado, unificadoEn };
    }
}

