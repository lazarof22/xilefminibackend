import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ConsecutivoDocumento,
  ConsecutivoDocumentoSchema,
} from './consecutivo.schema';
import { ConsecutivoService } from './consecutivo.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ConsecutivoDocumento.name, schema: ConsecutivoDocumentoSchema },
    ]),
  ],
  providers: [ConsecutivoService],
  exports: [ConsecutivoService],
})
export class ConsecutivoModule {}
