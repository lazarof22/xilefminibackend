import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ImportExportController } from './import-export.controller';
import { ImportExportService } from './import-export.service';
import {
  Producto,
  ProductoSchema,
} from '../../inventario/producto/schemas/producto.schema';
import {
  Cuenta,
  CuentaSchema,
} from '../../contabilidad/cuenta/schema/cuenta.schema';
import { NomencladorHelperModule } from '../nomenclador-helper/nomenclador-helper.module';
import { CuentaModule } from '../../contabilidad/cuenta/cuenta.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Producto.name, schema: ProductoSchema },
      { name: Cuenta.name, schema: CuentaSchema },
    ]),
    NomencladorHelperModule,
    CuentaModule,
  ],
  controllers: [ImportExportController],
  providers: [ImportExportService],
  exports: [ImportExportService],
})
export class ImportExportModule {}