import { Module } from '@nestjs/common';
import { FichasNormativasController } from './fichas-normativas.controller';
import { FichasNormativasService } from './fichas-normativas.service';

@Module({
  controllers: [FichasNormativasController],
  providers: [FichasNormativasService],
})
export class FichasNormativasModule {}
