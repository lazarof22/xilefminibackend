import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TurnoCajaController } from './turno-caja.controller';
import { TurnoCajaService } from './turno-caja.service';
import { TurnoCaja, TurnoCajaSchema } from './schema/turno-caja.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TurnoCaja.name, schema: TurnoCajaSchema },
    ]),
  ],
  controllers: [TurnoCajaController],
  providers: [TurnoCajaService],
  exports: [MongooseModule, TurnoCajaService],
})
export class TurnoCajaModule {}
