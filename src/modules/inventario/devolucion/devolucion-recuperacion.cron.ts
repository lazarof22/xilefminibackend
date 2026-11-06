import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DevolucionService } from './devolucion.service';

/** Periodically settles vales left in `aplicando` by an interrupted process. */
@Injectable()
export class DevolucionRecuperacionCron {
  private readonly logger = new Logger(DevolucionRecuperacionCron.name);

  constructor(private readonly devoluciones: DevolucionService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async recuperar(): Promise<void> {
    try {
      await this.devoluciones.recuperarInterrumpidas();
    } catch (error) {
      this.logger.error(
        `Recovery of interrupted vales failed: ${String(error)}`,
      );
    }
  }
}
