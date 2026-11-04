import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfiguracionTributariaController } from './configuracion-tributaria.controller';
import { ConfiguracionTributariaService } from './configuracion-tributaria.service';
import {
  ConfiguracionTributaria,
  ConfiguracionTributariaSchema,
} from './schemas/configuracion-tributaria.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ConfiguracionTributaria.name,
        schema: ConfiguracionTributariaSchema,
      },
    ]),
  ],
  controllers: [ConfiguracionTributariaController],
  providers: [ConfiguracionTributariaService],
  exports: [ConfiguracionTributariaService],
})
export class ConfiguracionTributariaModule {}
