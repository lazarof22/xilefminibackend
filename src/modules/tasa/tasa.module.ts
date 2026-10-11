import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { TasaService } from "./tasa.service";
import { TasaController } from "./tasa.controller";
import { Tasa, TasaSchema } from "./schemas/tasa.schema";
import { Moneda, MonedaSchema } from "../nomencladores/moneda/schema/moneda.schema";


@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Tasa.name,
        schema: TasaSchema,
      },
      {
        name: Moneda.name,
        schema: MonedaSchema,
      },
    ]),
  ],
  controllers: [TasaController],
  providers: [TasaService],
  exports: [TasaService],
})
export class TasaModule {}