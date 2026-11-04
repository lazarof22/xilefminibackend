import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArqueoCajaController } from './arqueo-caja.controller';
import { ArqueoCajaService } from './arqueo-caja.service';
import { ArqueoCaja, ArqueoCajaSchema } from './schema/arqueo-caja.schema';
import {
  TurnoCaja,
  TurnoCajaSchema,
} from '../turno-caja/schema/turno-caja.schema';
import {
  ReportePlus,
  ReportePlusSchema,
} from '../reporte_plus/schema/reporte_plus.schema';
import {
  LineaTurnoArchivada,
  LineaTurnoArchivadaSchema,
} from '../reporte_plus/schema/linea-turno-archivada.schema';
import {
  Extraccion,
  ExtraccionSchema,
} from '../extraccion/schema/extraccion.schema';
import {
  DepositoBancario,
  DepositoBancarioSchema,
} from '../deposito-bancario/schema/deposito-bancario.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ArqueoCaja.name, schema: ArqueoCajaSchema },
      { name: TurnoCaja.name, schema: TurnoCajaSchema },
      { name: ReportePlus.name, schema: ReportePlusSchema },
      { name: LineaTurnoArchivada.name, schema: LineaTurnoArchivadaSchema },
      { name: Extraccion.name, schema: ExtraccionSchema },
      { name: DepositoBancario.name, schema: DepositoBancarioSchema },
    ]),
  ],
  controllers: [ArqueoCajaController],
  providers: [ArqueoCajaService],
  exports: [MongooseModule, ArqueoCajaService],
})
export class ArqueoCajaModule {}
