import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecepcionController } from './recepcion.controller';
import { RecepcionService } from './recepcion.service';
import { Recepcion, RecepcionSchema } from './schema/recepcion.schema';
import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import { Almacen, AlmacenSchema } from '../almacen/schema/almacen.schema';
import {
  Contenedor,
  ContenedorSchema,
} from '../contenedor/schema/contenedor.schema';
import {
  Proveedor,
  ProveedorSchema,
} from '../../clientes y provedores/proveedor/schema/proveedor.schema';
import { ConsecutivoModule } from '../consecutivo/consecutivo.module';
import { ExistenciaModule } from '../exitencia/existencia.module';
import { RegistroCompraModule } from '../registro-compra/registro-compra.module';
import { EmpresaDatosModule } from '../../configuracion/empresa-datos/empresa-datos.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Recepcion.name, schema: RecepcionSchema },
      { name: Producto.name, schema: ProductoSchema },
      { name: Almacen.name, schema: AlmacenSchema },
      { name: Contenedor.name, schema: ContenedorSchema },
      { name: Proveedor.name, schema: ProveedorSchema },
    ]),
    ConsecutivoModule,
    ExistenciaModule,
    RegistroCompraModule,
    EmpresaDatosModule,
  ],
  controllers: [RecepcionController],
  providers: [RecepcionService],
  exports: [MongooseModule, RecepcionService],
})
export class RecepcionModule {}
