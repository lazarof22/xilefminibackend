import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OperacionIdempotenteService } from './operacion-idempotente.service';
import {
  OperacionIdempotente,
  OperacionIdempotenteSchema,
} from './schema/operacion-idempotente.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: OperacionIdempotente.name,
        schema: OperacionIdempotenteSchema,
      },
    ]),
  ],
  providers: [OperacionIdempotenteService],
  exports: [OperacionIdempotenteService],
})
export class OperacionIdempotenteModule {}
