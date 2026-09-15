import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  Nomenclador,
  NomencladorSchema,
} from './schemas/nomenclador.schema';

import {
  NomencladorValor,
  NomencladorValorSchema,
} from './schemas/nomenclador_valor.schema';

import { NomencladoresController } from './nomencladoresg.controller';
import { NomencladoresService } from './nomencladoresg.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Nomenclador.name,
        schema: NomencladorSchema,
      },
      {
        name: NomencladorValor.name,
        schema: NomencladorValorSchema,
      },
    ]),
  ],
  controllers: [NomencladoresController],
  providers: [NomencladoresService],
  exports: [NomencladoresService],
})
export class NomencladoresModule {}