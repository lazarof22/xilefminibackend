import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReporteInventarioController } from './reporte-inventario.controller';
import { ReporteInventarioService } from './reporte-inventario.service';
import { ReservasPorProductoService } from './reservas-por-producto.service';
import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import { ExistenciaModule } from '../exitencia/existencia.module';

@Module({
  controllers: [ReporteInventarioController],
  providers: [ReporteInventarioService, ReservasPorProductoService],
  imports: [
    ExistenciaModule,
    MongooseModule.forFeature([
      { name: Producto.name, schema: ProductoSchema },
    ]),
  ],
})
export class ReporteInventarioModule {}
