import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExtraccionService } from './extraccion.service';
import { ExtraccionController } from './extraccion.controller';
import { Extraccion, ExtraccionSchema } from './schema/extraccion.schema';
import { AuthModule } from '../../auth/auth.module';
import {
  TurnoCaja,
  TurnoCajaSchema,
} from '../turno-caja/schema/turno-caja.schema';

@Module({
  controllers: [ExtraccionController],
  providers: [ExtraccionService],
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Extraccion.name, schema: ExtraccionSchema },
      { name: TurnoCaja.name, schema: TurnoCajaSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class ExtraccionModule {}
