import { Injectable, Logger } from '@nestjs/common';
import { LicenciaArtifactV3 } from './payload-builder';
import { writeFileAtomic } from '../utils/atomic-write.util';
import { resolveLicenseFilePath } from '../utils/licencia-paths.util';

/**
 * Writes the imported signed artifact to disk (`LICENSE_FILE_PATH`, default
 * `./license.lic`) as a backup/export. Atomic, mode 0600, errors surfaced.
 *
 * The file is WRITE-ONLY for the backend: it is never read back as a source of
 * truth (no DB-error fallback, no grace period). To restore it, an admin
 * re-imports it through `POST /licencia/activar`, which re-verifies signature,
 * hardware binding, empresa and clock.
 */
@Injectable()
export class LicenciaOfflineService {
  private readonly logger = new Logger(LicenciaOfflineService.name);

  async exportarArtefacto(artifact: LicenciaArtifactV3): Promise<void> {
    const target = resolveLicenseFilePath();
    const content: LicenciaArtifactV3 = {
      version_firma: artifact.version_firma,
      payload: artifact.payload,
      firma: artifact.firma,
    };
    try {
      await writeFileAtomic(target, JSON.stringify(content, null, 2) + '\n');
    } catch (error) {
      this.logger.error(
        `Could not write license file ${target}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
