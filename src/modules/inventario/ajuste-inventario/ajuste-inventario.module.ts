import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AjusteInventarioController } from './ajuste-inventario.controller';
import { AjusteInventarioService } from './ajuste-inventario.service';
import {
  AjusteInventario,
  AjusteInventarioSchema,
} from './schema/ajuste-inventario.schema';
import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import {
  Contenedor,
  ContenedorSchema,
} from '../contenedor/schema/contenedor.schema';
import {
  Existencia,
  ExistenciaSchema,
} from '../exitencia/schema/existencia.schema';
import { ExistenciaModule } from '../exitencia/existencia.module';
import { KardexModule } from '../kardex/kardex.module';
import { ConsecutivoModule } from '../consecutivo/consecutivo.module';
import { CausaDisminucionModule } from '../../nomencladores/causa-disminucion/causa-disminucion.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AjusteInventario.name, schema: AjusteInventarioSchema },
      { name: Producto.name, schema: ProductoSchema },
      { name: Contenedor.name, schema: ContenedorSchema },
      { name: Existencia.name, schema: ExistenciaSchema },
    ]),
    ExistenciaModule,
    KardexModule,
    ConsecutivoModule,
    CausaDisminucionModule,
  ],
  controllers: [AjusteInventarioController],
  providers: [AjusteInventarioService],
  exports: [MongooseModule, AjusteInventarioService],
})
export class AjusteInventarioModule {}
