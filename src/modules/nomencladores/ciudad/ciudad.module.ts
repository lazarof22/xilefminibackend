import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CiudadService } from './ciudad.service';
import { CiudadController } from './ciudad.controller';
import { Ciudad, CiudadSchema } from './schema/ciudad.schema';
import { PaisModule } from '../pais/pais.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Ciudad.name, schema: CiudadSchema }]),
    PaisModule,
  ],
  controllers: [CiudadController],
  providers: [CiudadService],
  exports: [MongooseModule, CiudadService],
})
export class CiudadModule {}
