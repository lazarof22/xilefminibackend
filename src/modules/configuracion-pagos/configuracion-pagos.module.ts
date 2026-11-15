import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfiguracionPagosController } from './configuracion-pagos.controller';
import { ConfiguracionPagosService } from './configuracion-pagos.service';
import {
  ConfiguracionPagos,
  ConfiguracionPagosSchema,
} from './schema/configuracion-pagos.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConfiguracionPagos.name, schema: ConfiguracionPagosSchema },
    ]),
  ],
  controllers: [ConfiguracionPagosController],
  providers: [ConfiguracionPagosService],
  exports: [ConfiguracionPagosService],
})
export class ConfiguracionPagosModule {}
