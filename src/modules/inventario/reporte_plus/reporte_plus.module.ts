import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportePlusService } from './reporte_plus.service';
import { ReportePlusController } from './reporte_plus.controller';
import { ReportePlus, ReportePlusSchema } from './schema/reporte_plus.schema';
import {
  TurnoReportePlus,
  TurnoReportePlusSchema,
} from './schema/turno_reporte_plus.schema';
import { Kardex, KardexSchema } from '../kardex/schema/kardex.schema';
import {
  Extraccion,
  ExtraccionSchema,
} from '../extraccion/schema/extraccion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReportePlus.name, schema: ReportePlusSchema },
      { name: TurnoReportePlus.name, schema: TurnoReportePlusSchema },
      { name: Kardex.name, schema: KardexSchema },
      { name: Extraccion.name, schema: ExtraccionSchema },
    ]),
  ],
  controllers: [ReportePlusController],
  providers: [ReportePlusService],
  exports: [MongooseModule, ReportePlusService],
})
export class ReportePlusModule {}
