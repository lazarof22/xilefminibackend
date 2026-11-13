import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BancoController } from './banco.controller';
import { BancoService } from './banco.service';
import { Banco, BancoSchema } from './schema/banco.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Banco.name, schema: BancoSchema }]),
  ],
  controllers: [BancoController],
  providers: [BancoService],
  exports: [BancoService],
})
export class BancoModule {}
