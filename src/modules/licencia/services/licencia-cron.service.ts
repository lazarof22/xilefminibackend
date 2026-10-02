import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LicenciaService } from '../licencia.service';

/**
 * Daily re-derivation of every license from its signed payload. There is no
 * stored `activa` flag to flip: status is always derived. The run also
 * advances the monotonic clock state and audits non-valid licenses.
 */
@Injectable()
export class LicenciaCronService {
  private readonly logger = new Logger(LicenciaCronService.name);

  constructor(private readonly licenciaService: LicenciaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async reevaluar(): Promise<void> {
    try {
      const resumen = await this.licenciaService.reevaluarTodas();
      this.logger.log(`License re-evaluation: ${JSON.stringify(resumen)}`);
    } catch (error) {
      this.logger.error(
        `License re-evaluation failed: ${(error as Error).message}`,
      );
    }
  }
}
