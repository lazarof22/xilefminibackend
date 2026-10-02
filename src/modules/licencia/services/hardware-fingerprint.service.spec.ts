import * as crypto from 'crypto';
import {
  computeHardwareFingerprint,
  HardwareFingerprintService,
  MachineIdSources,
  readMachineId,
} from './hardware-fingerprint.service';
import { HARDWARE_FINGERPRINT_NAMESPACE } from '../constants/licencia.constants';

function sources(over: Partial<MachineIdSources>): MachineIdSources {
  return {
    platform: 'linux',
    readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
    execFile: jest.fn().mockRejectedValue(new Error('not available')),
    ...over,
  };
}

describe('hardware fingerprint', () => {
  describe('computeHardwareFingerprint', () => {
    it('is sha256 hex of namespace, platform and normalized machine id', () => {
      const expected = crypto
        .createHash('sha256')
        .update(`${HARDWARE_FINGERPRINT_NAMESPACE}:linux:abcdef0123456789`)
        .digest('hex');
      expect(computeHardwareFingerprint('linux', ' ABCDEF0123456789\n')).toBe(
        expected,
      );
    });

    it('differs per machine id', () => {
      expect(computeHardwareFingerprint('linux', 'a'.repeat(32))).not.toBe(
        computeHardwareFingerprint('linux', 'b'.repeat(32)),
      );
    });
  });

  describe('readMachineId', () => {
    it('reads /etc/machine-id on linux', async () => {
      const readFile = jest
        .fn()
        .mockResolvedValue('0123456789abcdef0123456789abcdef\n');
      const id = await readMachineId(sources({ readFile }));
      expect(id).toBe('0123456789abcdef0123456789abcdef');
      expect(readFile).toHaveBeenCalledWith('/etc/machine-id');
    });

    it('falls back to the dbus machine id on linux', async () => {
      const readFile = jest
        .fn()
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce('fedcba9876543210fedcba9876543210');
      const id = await readMachineId(sources({ readFile }));
      expect(id).toBe('fedcba9876543210fedcba9876543210');
      expect(readFile).toHaveBeenLastCalledWith('/var/lib/dbus/machine-id');
    });

    it('reads MachineGuid from the registry on windows', async () => {
      const execFile = jest
        .fn()
        .mockResolvedValue(
          '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n' +
            '    MachineGuid    REG_SZ    6f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b\r\n',
        );
      const id = await readMachineId(sources({ platform: 'win32', execFile }));
      expect(id).toBe('6f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
      expect(execFile).toHaveBeenCalledWith('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
      ]);
    });

    it('reads IOPlatformUUID on macOS', async () => {
      const execFile = jest
        .fn()
        .mockResolvedValue(
          '+-o J316sAP  <class IOPlatformExpertDevice>\n' +
            '    "IOPlatformUUID" = "12345678-ABCD-4EF0-9123-456789ABCDEF"\n',
        );
      const id = await readMachineId(sources({ platform: 'darwin', execFile }));
      expect(id).toBe('12345678-ABCD-4EF0-9123-456789ABCDEF');
      expect(execFile).toHaveBeenCalledWith('ioreg', [
        '-rd1',
        '-c',
        'IOPlatformExpertDevice',
      ]);
    });

    it('fails closed when no identifier can be read', async () => {
      await expect(readMachineId(sources({}))).rejects.toThrow();
      await expect(
        readMachineId(sources({ platform: 'win32' })),
      ).rejects.toThrow();
      await expect(
        readMachineId(sources({ platform: 'aix' })),
      ).rejects.toThrow();
    });

    it('rejects implausibly short identifiers', async () => {
      const readFile = jest.fn().mockResolvedValue('abc\n');
      await expect(readMachineId(sources({ readFile }))).rejects.toThrow();
    });

    it('rejects unparseable command output', async () => {
      const execFile = jest.fn().mockResolvedValue('nothing here');
      await expect(
        readMachineId(sources({ platform: 'darwin', execFile })),
      ).rejects.toThrow();
    });
  });

  describe('HardwareFingerprintService', () => {
    it('computes once and caches', async () => {
      const readFile = jest
        .fn()
        .mockResolvedValue('0123456789abcdef0123456789abcdef');
      const service = new HardwareFingerprintService(sources({ readFile }));
      const first = await service.getFingerprint();
      const second = await service.getFingerprint();
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(second).toBe(first);
      expect(readFile).toHaveBeenCalledTimes(1);
    });

    it('propagates failures (fail closed) and does not cache them', async () => {
      const readFile = jest
        .fn()
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce('0123456789abcdef0123456789abcdef');
      const service = new HardwareFingerprintService(sources({ readFile }));
      await expect(service.getFingerprint()).rejects.toThrow();
      await expect(service.getFingerprint()).resolves.toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
