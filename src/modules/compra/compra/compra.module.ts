import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CompraService } from './compra.service';
import { CompraController } from './compra.controller';
import { Compra, CompraSchema } from './schema/compra.schema';
import {
  Empresa,
  EmpresaSchema,
} from '../../clientes y provedores/empresa/schema/empresa.schema';

@Module({
  controllers: [CompraController],
  providers: [CompraService],
  imports: [
    MongooseModule.forFeature([
      { name: Compra.name, schema: CompraSchema },
      { name: Empresa.name, schema: EmpresaSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class CompraModule {}
