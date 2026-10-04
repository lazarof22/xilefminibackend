import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";

import { TasaService } from "./tasa.service";
import { TasaController } from "./tasa.controller";
import { Tasa, TasaSchema } from "./schemas/tasa.schema";

import { NomencladoresModule } from "../nomencladore generales/nomencladoresg.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Tasa.name,
        schema: TasaSchema,
      },
    ]),

    NomencladoresModule,
  ],
  controllers: [TasaController],
  providers: [TasaService],
  exports: [TasaService],
})
export class TasaModule {}
