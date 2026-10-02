import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LicenciaController } from './licencia.controller';
import { LicenciaService } from './licencia.service';
import { Licencia, LicenciaSchema } from './schemas/licencia.schema';
import {
  AuditoriaLicencia,
  AuditoriaLicenciaSchema,
} from './schemas/auditoria-licencia.schema';
import { LicenciaCryptoService } from './services/licencia-crypto.service';
import { HardwareFingerprintService } from './services/hardware-fingerprint.service';
import { LicenciaClockService } from './services/licencia-clock.service';
import { LicenciaAuditService } from './services/licencia-audit.service';
import { LicenciaCronService } from './services/licencia-cron.service';
import { LicenciaOfflineService } from './services/licencia-offline.service';
import { LicenciaGuard } from './guards/licencia.guard';
import {
  LICENCIA_TRUSTED_KEYS,
  LICENCIA_TRUSTED_PUBLIC_KEYS,
} from './constants/licencia.constants';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Licencia.name, schema: LicenciaSchema },
      { name: AuditoriaLicencia.name, schema: AuditoriaLicenciaSchema },
    ]),
    ScheduleModule,
    ThrottlerModule,
  ],
  controllers: [LicenciaController],
  providers: [
    LicenciaService,
    { provide: LICENCIA_TRUSTED_KEYS, useValue: LICENCIA_TRUSTED_PUBLIC_KEYS },
    LicenciaCryptoService,
    HardwareFingerprintService,
    LicenciaClockService,
    LicenciaAuditService,
    LicenciaCronService,
    LicenciaOfflineService,
    // Provided (not applied): see LicenciaGuard docs.
    LicenciaGuard,
  ],
  exports: [LicenciaService, LicenciaGuard],
})
export class LicenciaModule {}
