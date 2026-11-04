import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportePlusService } from './reporte_plus.service';
import { ReportePlusController } from './reporte_plus.controller';
import { ReportePlus, ReportePlusSchema } from './schema/reporte_plus.schema';
import {
  TurnoReportePlus,
  TurnoReportePlusSchema,
} from './schema/turno_reporte_plus.schema';
import {
  LineaTurnoArchivada,
  LineaTurnoArchivadaSchema,
} from './schema/linea-turno-archivada.schema';
import {
  TurnoCaja,
  TurnoCajaSchema,
} from '../turno-caja/schema/turno-caja.schema';
import {
  DepositoBancario,
  DepositoBancarioSchema,
} from '../deposito-bancario/schema/deposito-bancario.schema';
import { Kardex, KardexSchema } from '../kardex/schema/kardex.schema';
import {
  Extraccion,
  ExtraccionSchema,
} from '../extraccion/schema/extraccion.schema';

import {
  Devolucion,
  DevolucionSchema,
} from '../devolucion/schema/devolucion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReportePlus.name, schema: ReportePlusSchema },
      { name: TurnoReportePlus.name, schema: TurnoReportePlusSchema },
      { name: Kardex.name, schema: KardexSchema },
      { name: Extraccion.name, schema: ExtraccionSchema },
      { name: TurnoCaja.name, schema: TurnoCajaSchema },
      { name: DepositoBancario.name, schema: DepositoBancarioSchema },
      { name: LineaTurnoArchivada.name, schema: LineaTurnoArchivadaSchema },
      { name: Devolucion.name, schema: DevolucionSchema },
    ]),
  ],
  controllers: [ReportePlusController],
  providers: [ReportePlusService],
  exports: [MongooseModule, ReportePlusService],
})
export class ReportePlusModule {}
