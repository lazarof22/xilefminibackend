import { Module } from '@nestjs/common';
import { CanalPagoController } from './canal-pago.controller';

@Module({
  controllers: [CanalPagoController],
})
export class CanalPagoModule {}
