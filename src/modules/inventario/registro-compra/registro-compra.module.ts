import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { RegistroCompraController } from './registro-compra.controller';
import { RegistroCompraService } from './registro-compra.service';
import {
    RegistroCompra,
    RegistroCompraSchema,
} from './schema/registro-compra.schema';

import { Producto, ProductoSchema } from '../producto/schemas/producto.schema';
import { Almacen, AlmacenSchema } from '../almacen/schema/almacen.schema';
import { Contenedor, ContenedorSchema } from '../contenedor/schema/contenedor.schema';
import { Kardex, KardexSchema } from '../kardex/schema/kardex.schema';

@Module({
    controllers: [RegistroCompraController],
    providers: [RegistroCompraService],
    imports: [
        MongooseModule.forFeature([
            { name: RegistroCompra.name, schema: RegistroCompraSchema },
            { name: Producto.name, schema: ProductoSchema },
            { name: Almacen.name, schema: AlmacenSchema },
            { name: Contenedor.name, schema: ContenedorSchema },
            { name: Kardex.name, schema: KardexSchema },
        ]),
    ],
    exports: [MongooseModule],
})
export class RegistroCompraModule {}
