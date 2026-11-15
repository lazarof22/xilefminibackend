import { ArqueoCajaModule } from '../arqueo-caja/arqueo-caja.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DepositoBancarioController } from './deposito-bancario.controller';
import { DepositoBancarioService } from './deposito-bancario.service';
import {
  DepositoBancario,
  DepositoBancarioSchema,
} from './schema/deposito-bancario.schema';
import {
  ConfiguracionDeposito,
  ConfiguracionDepositoSchema,
} from './schema/configuracion-deposito.schema';
import {
  TurnoCaja,
  TurnoCajaSchema,
} from '../turno-caja/schema/turno-caja.schema';

@Module({
  imports: [
    ArqueoCajaModule,
    MongooseModule.forFeature([
      { name: DepositoBancario.name, schema: DepositoBancarioSchema },
      { name: ConfiguracionDeposito.name, schema: ConfiguracionDepositoSchema },
      { name: TurnoCaja.name, schema: TurnoCajaSchema },
    ]),
  ],
  controllers: [DepositoBancarioController],
  providers: [DepositoBancarioService],
  exports: [MongooseModule, DepositoBancarioService],
})
export class DepositoBancarioModule {}
