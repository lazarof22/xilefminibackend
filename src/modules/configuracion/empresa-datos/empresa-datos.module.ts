import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmpresaDatosController } from './empresa-datos.controller';
import { EmpresaDatosService } from './empresa-datos.service';
import {
  EmpresaDatos,
  EmpresaDatosSchema,
} from './schemas/empresa-datos.schema';
import { CiudadModule } from '../../nomencladores/ciudad/ciudad.module';
import { NomencladorHelperModule } from '../nomenclador-helper/nomenclador-helper.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmpresaDatos.name, schema: EmpresaDatosSchema },
    ]),
    NomencladorHelperModule,
    CiudadModule,
  ],
  controllers: [EmpresaDatosController],
  providers: [EmpresaDatosService],
  exports: [EmpresaDatosService],
})
export class EmpresaDatosModule {}
