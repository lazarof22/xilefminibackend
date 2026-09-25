import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FacturaService } from './factura.service';
import { FacturaController } from './factura.controller';
import { FacturaInventarioService } from './factura-inventario.service';
import { Factura, FacturaSchema } from './schema/factura.schema';
import {
  FacturaContador,
  FacturaContadorSchema,
} from './schema/factura-contador.schema';
import {
  Cliente,
  ClienteSchema,
} from '../clientes y provedores/cliente/schemas/cliente.schema';
import {
  Almacen,
  AlmacenSchema,
} from '../inventario/almacen/schema/almacen.schema';
import {
  Producto,
  ProductoSchema,
} from '../inventario/producto/schemas/producto.schema';
import { Pais, PaisSchema } from '../nomencladores/pais/schema/pais.schema';
import { Usuario, UsuarioSchema } from '../auth/schemas/empleado.schema';
import {
  Kardex,
  KardexSchema,
} from '../inventario/kardex/schema/kardex.schema';
import {
  Estado,
  EstadoSchema,
} from '../nomencladores/estado/schema/estado.schema';
import { EmpresaDatosModule } from '../configuracion/empresa-datos/empresa-datos.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Factura.name, schema: FacturaSchema },
      { name: FacturaContador.name, schema: FacturaContadorSchema },
      { name: Cliente.name, schema: ClienteSchema },
      { name: Almacen.name, schema: AlmacenSchema },
      { name: Producto.name, schema: ProductoSchema },
      { name: Pais.name, schema: PaisSchema },
      { name: Usuario.name, schema: UsuarioSchema },
      { name: Kardex.name, schema: KardexSchema },
      { name: Estado.name, schema: EstadoSchema },
    ]),
    EmpresaDatosModule,
  ],
  controllers: [FacturaController],
  providers: [FacturaService, FacturaInventarioService],
  exports: [MongooseModule],
})
export class FacturaModule {}
