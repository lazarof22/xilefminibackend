import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LicenciaClockService } from './licencia-clock.service';
import { HardwareFingerprintService } from './hardware-fingerprint.service';
import { CLOCK_TOLERANCE_MS } from '../constants/licencia.constants';

function hw(fingerprint: string): HardwareFingerprintService {
  return {
    getFingerprint: jest.fn().mockResolvedValue(fingerprint),
  } as unknown as HardwareFingerprintService;
}

describe('LicenciaClockService', () => {
  const T0 = Date.parse('2026-06-01T00:00:00.000Z');
  let dir: string;
  let statePath: string;
  const env = { ...process.env };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-clock-'));
    statePath = path.join(dir, 'license.state');
    process.env.LICENSE_STATE_PATH = statePath;
  });

  afterEach(() => {
    process.env = { ...env };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the state file (0600) when missing', async () => {
    const svc = new LicenciaClockService(hw('a'.repeat(64)));
    const r = await svc.observe(T0);
    expect(r).toEqual({ ok: true, ahoraMs: T0, ultimoVistoMs: null });
    expect(fs.existsSync(statePath)).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
    }
  });

  it('advances last_seen monotonically', async () => {
    const svc = new LicenciaClockService(hw('a'.repeat(64)));
    await svc.observe(T0);
    const r = await svc.observe(T0 + 60_000);
    expect(r).toEqual({ ok: true, ahoraMs: T0 + 60_000, ultimoVistoMs: T0 });
    const back = await svc.observe(T0 + 1_000);
    expect(back.ok).toBe(true);
    // last_seen keeps the max, never moves back
    const again = await svc.observe(T0 + 2_000);
    expect(again).toMatchObject({ ultimoVistoMs: T0 + 60_000 });
  });

  it('tolerates small backwards drift', async () => {
    const svc = new LicenciaClockService(hw('a'.repeat(64)));
    await svc.observe(T0);
    const r = await svc.observe(T0 - CLOCK_TOLERANCE_MS + 1);
    expect(r.ok).toBe(true);
  });

  it('flags a clock rolled back beyond tolerance', async () => {
    const svc = new LicenciaClockService(hw('a'.repeat(64)));
    await svc.observe(T0);
    const r = await svc.observe(T0 - CLOCK_TOLERANCE_MS - 1);
    expect(r).toMatchObject({ ok: false, codigo: 'reloj_alterado' });
    // rollback does not lower the stored value
    const later = await svc.observe(T0 - CLOCK_TOLERANCE_MS - 1);
    expect(later.ok).toBe(false);
  });

  it('uses an external floor when the state file was deleted', async () => {
    const svc = new LicenciaClockService(hw('a'.repeat(64)));
    await svc.observe(T0);
    fs.rmSync(statePath);
    const r = await svc.observe(T0 - CLOCK_TOLERANCE_MS - 1, T0);
    expect(r).toMatchObject({ ok: false, codigo: 'reloj_alterado' });
  });

  it('flags a tampered last_seen value', async () => {
    const svc = new LicenciaClockService(hw('a'.repeat(64)));
    await svc.observe(T0);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      last_seen_ms: number;
    };
    state.last_seen_ms = T0 - 365 * 24 * 3600 * 1000;
    fs.writeFileSync(statePath, JSON.stringify(state));
    const r = await svc.observe(T0 - 300 * 24 * 3600 * 1000);
    expect(r).toMatchObject({ ok: false, codigo: 'estado_alterado' });
  });

  it.each(['not json', '{}', '{"v":1,"last_seen_ms":-1,"mac":"00"}', '[]'])(
    'flags a corrupt state file: %s',
    async (content) => {
      fs.writeFileSync(statePath, content);
      const svc = new LicenciaClockService(hw('a'.repeat(64)));
      const r = await svc.observe(T0);
      expect(r).toMatchObject({ ok: false, codigo: 'estado_alterado' });
    },
  );

  it('binds the MAC key to the hardware fingerprint', async () => {
    await new LicenciaClockService(hw('a'.repeat(64))).observe(T0);
    const other = new LicenciaClockService(hw('b'.repeat(64)));
    const r = await other.observe(T0 + 1000);
    expect(r).toMatchObject({ ok: false, codigo: 'estado_alterado' });
  });

  it('propagates fingerprint failures (caller fails closed)', async () => {
    const failing = {
      getFingerprint: jest.fn().mockRejectedValue(new Error('no machine id')),
    } as unknown as HardwareFingerprintService;
    await expect(
      new LicenciaClockService(failing).observe(T0),
    ).rejects.toThrow();
  });

  it('propagates state write failures', async () => {
    process.env.LICENSE_STATE_PATH = path.join(dir, 'missing', 'license.state');
    const svc = new LicenciaClockService(hw('a'.repeat(64)));
    await expect(svc.observe(T0)).rejects.toThrow();
  });
});
