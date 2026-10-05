import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
    Transferencia,
    TransferenciaSchema,
} from './schema/transferencia.schema';

import {
    TransferenciaController,
} from './transferencia.controller';

import {
    TransferenciaService,
} from './transferencia.service';

import {
    Almacen,
    AlmacenSchema,
} from '../almacen/schema/almacen.schema';

import {
    Contenedor,
    ContenedorSchema,
} from '../contenedor/schema/contenedor.schema';

import {
    Producto,
    ProductoSchema,
} from '../producto/schemas/producto.schema';

import {
    Kardex,
    KardexSchema,
} from '../kardex/schema/kardex.schema';

import {
    Existencia,
    ExistenciaSchema,
} from '../exitencia/schema/existencia.schema';

import { ExistenciaModule } from '../exitencia/existencia.module';

@Module({
    controllers: [
        TransferenciaController,
    ],

    providers: [
        TransferenciaService,
    ],

    imports: [
        ExistenciaModule,
        MongooseModule.forFeature([
            {
                name: Transferencia.name,
                schema: TransferenciaSchema,
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
                name: Producto.name,
                schema: ProductoSchema,
            },
            {
                name: Kardex.name,
                schema: KardexSchema,
            },
            {
                name: Existencia.name,
                schema: ExistenciaSchema,
            },
        ]),
    ],

    exports: [
        MongooseModule,
    ],
})
export class TransferenciaModule { }