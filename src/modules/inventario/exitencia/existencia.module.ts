import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
    Existencia,
    ExistenciaSchema,
} from './schema/existencia.schema';

import { ExistenciaController } from './existencia.controller';
import { ExistenciaService } from './existencia.service';
import { ConciliacionController } from './conciliacion.controller';
import { ConciliacionService } from './conciliacion.service';

import {
    ConfiguracionInventario,
    ConfiguracionInventarioSchema,
} from './schema/configuracion-inventario.schema';

import {
    ConciliacionExistencia,
    ConciliacionExistenciaSchema,
} from './schema/conciliacion-existencia.schema';

import {
    Kardex,
    KardexSchema,
} from '../kardex/schema/kardex.schema';

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
    controllers: [ExistenciaController, ConciliacionController],

    providers: [ExistenciaService, ConciliacionService],

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
            {
                name: ConfiguracionInventario.name,
                schema: ConfiguracionInventarioSchema,
            },
            {
                name: ConciliacionExistencia.name,
                schema: ConciliacionExistenciaSchema,
            },
            {
                name: Kardex.name,
                schema: KardexSchema,
            },
        ]),
    ],

    exports: [
        ExistenciaService,
        MongooseModule,
    ],
})
export class ExistenciaModule {}

