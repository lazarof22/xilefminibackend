import { Module } from '@nestjs/common';
import { PaisService } from './pais.service';
import { PaisController } from './pais.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Pais, PaisSchema } from './schema/pais.schema';
import { Ciudad, CiudadSchema } from '../ciudad/schema/ciudad.schema';

@Module({
  controllers: [PaisController],
  providers: [PaisService],

  imports: [
    MongooseModule.forFeature([
      { name: Pais.name, schema: PaisSchema },
      // Solo para comprobar si un país tiene ciudades antes de eliminarlo.
      { name: Ciudad.name, schema: CiudadSchema },
    ]),
  ],
  exports: [MongooseModule, PaisService],
})
export class PaisModule {}
