import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { LicenciaOfflineService } from './licencia-offline.service';
import { LicenciaArtifactV3 } from './payload-builder';

const artifact: LicenciaArtifactV3 = {
  version_firma: 3,
  firma: 'ab'.repeat(64),
  payload: {
    activa: true,
    emitida_en: '2026-01-01T12:00:00.000Z',
    empresa_id: 'EMP-001',
    fecha_inicio: '2026-01-01T00:00:00.000Z',
    fecha_vencimiento: '2027-01-01T00:00:00.000Z',
    hardware_fingerprint: 'a'.repeat(64),
    license_id: '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f',
    max_usuarios: 5,
    revocada: false,
    secuencia: 1,
    tipo: 'suscripcion_anual',
  },
};

describe('LicenciaOfflineService', () => {
  let dir: string;
  const env = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-offline-'));
  });

  afterEach(() => {
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('exports exactly the signed artifact with mode 0600', async () => {
    const file = path.join(dir, 'license.lic');
    process.env.LICENSE_FILE_PATH = file;
    await new LicenciaOfflineService().exportarArtefacto(artifact);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(artifact);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('logs and rethrows write errors', async () => {
    process.env.LICENSE_FILE_PATH = path.join(dir, 'nope', 'license.lic');
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await expect(
      new LicenciaOfflineService().exportarArtefacto(artifact),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});
