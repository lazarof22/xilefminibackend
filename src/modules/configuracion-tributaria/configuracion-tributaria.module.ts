import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfiguracionTributariaService } from './configuracion-tributaria.service';
import {
  ConfiguracionTributaria,
  ConfiguracionTributariaSchema,
} from './schema/configuracion-tributaria.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ConfiguracionTributaria.name,
        schema: ConfiguracionTributariaSchema,
      },
    ]),
  ],
  providers: [ConfiguracionTributariaService],
  exports: [ConfiguracionTributariaService],
})
export class ConfiguracionTributariaModule {}
