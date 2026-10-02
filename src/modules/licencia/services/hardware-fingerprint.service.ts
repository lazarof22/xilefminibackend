import { Inject, Injectable, Optional } from '@nestjs/common';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { HARDWARE_FINGERPRINT_NAMESPACE } from '../constants/licencia.constants';

/**
 * Side-effecting primitives used to read the machine identifier. Injectable so
 * tests can replace them; production uses the real fs / child_process.
 */
export interface MachineIdSources {
  platform: NodeJS.Platform;
  readFile: (filePath: string) => Promise<string>;
  execFile: (file: string, args: string[]) => Promise<string>;
}

export const MACHINE_ID_SOURCES = Symbol('MACHINE_ID_SOURCES');

const LINUX_MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
const MIN_MACHINE_ID_LENGTH = 16;
const EXEC_TIMEOUT_MS = 5000;

function defaultSources(): MachineIdSources {
  return {
    platform: process.platform,
    readFile: (filePath) => fs.promises.readFile(filePath, 'utf8'),
    execFile: (file, args) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          file,
          args,
          { timeout: EXEC_TIMEOUT_MS, windowsHide: true },
          (error: Error | null, stdout: string | Buffer) => {
            if (error) reject(error);
            else resolve(stdout.toString());
          },
        );
      }),
  };
}

function assertPlausible(id: string | undefined, source: string): string {
  const trimmed = (id ?? '').trim();
  if (trimmed.length < MIN_MACHINE_ID_LENGTH) {
    throw new Error(`Machine identifier from ${source} is missing or invalid`);
  }
  return trimmed;
}

/**
 * Reads a stable machine identifier. Deliberately ignores hostname and MAC
 * addresses (both change too easily). Throws when nothing can be read: the
 * caller must treat that as "license invalid" (fail closed).
 */
export async function readMachineId(src: MachineIdSources): Promise<string> {
  switch (src.platform) {
    case 'linux': {
      for (const p of LINUX_MACHINE_ID_PATHS) {
        try {
          return assertPlausible(await src.readFile(p), p);
        } catch {
          // try the next location
        }
      }
      throw new Error('No readable machine-id on this Linux host');
    }
    case 'win32': {
      const out = await src.execFile('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
      ]);
      const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
      return assertPlausible(match?.[1], 'MachineGuid');
    }
    case 'darwin': {
      const out = await src.execFile('ioreg', [
        '-rd1',
        '-c',
        'IOPlatformExpertDevice',
      ]);
      const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
      return assertPlausible(match?.[1], 'IOPlatformUUID');
    }
    default:
      throw new Error(
        `Unsupported platform for hardware binding: ${src.platform}`,
      );
  }
}

export function computeHardwareFingerprint(
  platform: string,
  machineId: string,
): string {
  const normalized = machineId.trim().toLowerCase();
  return crypto
    .createHash('sha256')
    .update(`${HARDWARE_FINGERPRINT_NAMESPACE}:${platform}:${normalized}`)
    .digest('hex');
}

/**
 * Computes the hardware fingerprint SERVER-SIDE. The client never supplies it.
 * There is intentionally no env override.
 */
@Injectable()
export class HardwareFingerprintService {
  private readonly sources: MachineIdSources;
  private cached: string | null = null;

  constructor(
    @Optional() @Inject(MACHINE_ID_SOURCES) sources?: MachineIdSources,
  ) {
    this.sources = sources ?? defaultSources();
  }

  async getFingerprint(): Promise<string> {
    if (this.cached) return this.cached;
    const machineId = await readMachineId(this.sources);
    this.cached = computeHardwareFingerprint(this.sources.platform, machineId);
    return this.cached;
  }
}
