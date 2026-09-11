import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ComprobanteTipoService } from './comprobante-tipo.service';
import { ComprobanteTipoController } from './comprobante-tipo.controller';
import {
  ComprobanteTipo,
  ComprobanteTipoSchema,
} from './schema/comprobante-tipo.schema';

@Module({
  controllers: [ComprobanteTipoController],
  providers: [ComprobanteTipoService],
  imports: [
    MongooseModule.forFeature([
      { name: ComprobanteTipo.name, schema: ComprobanteTipoSchema },
    ]),
  ],
  exports: [MongooseModule, ComprobanteTipoService],
})
export class ComprobanteTipoModule {}