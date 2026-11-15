import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DenominacionMonedaController } from './denominacion-moneda.controller';
import { DenominacionMonedaService } from './denominacion-moneda.service';
import {
  DenominacionMoneda,
  DenominacionMonedaSchema,
} from './schema/denominacion-moneda.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DenominacionMoneda.name, schema: DenominacionMonedaSchema },
    ]),
  ],
  controllers: [DenominacionMonedaController],
  providers: [DenominacionMonedaService],
  exports: [DenominacionMonedaService],
})
export class DenominacionMonedaModule {}
