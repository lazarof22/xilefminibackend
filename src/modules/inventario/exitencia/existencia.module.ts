import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
    Existencia,
    ExistenciaSchema,
} from './schema/existencia.schema';

import { ExistenciaController } from './existencia.controller';
import { ExistenciaService } from './existencia.service';

import {
    Producto,
    ProductoSchema,
} from '../producto/schemas/producto.schema';

import {
    Almacen,
    AlmacenSchema,
} from '../almacen/schema/almacen.schema';

import {
    Contenedor,
    ContenedorSchema,
} from '../contenedor/schema/contenedor.schema';

@Module({
    controllers: [ExistenciaController],

    providers: [ExistenciaService],

    imports: [
        MongooseModule.forFeature([
            {
                name: Existencia.name,
                schema: ExistenciaSchema,
            },
            {
                name: Producto.name,
                schema: ProductoSchema,
            },
            {
                name: Almacen.name,
                schema: AlmacenSchema,
            },
            {
                name: Contenedor.name,
                schema: ContenedorSchema,
            },
        ]),
    ],

    exports: [
        ExistenciaService,
        MongooseModule,
    ],
})
export class ExistenciaModule {}

