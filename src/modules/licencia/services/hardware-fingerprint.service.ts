import { Inject, Injectable, Optional } from '@nestjs/common';
import { execFile as execFileCallback } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { HARDWARE_FINGERPRINT_NAMESPACE } from '../constants/licencia.constants';

/**
 * Side-effecting primitives used to read the machine identifier. Injectable so
 * tests can replace them; production uses the real fs / child_process.
 */
export interface MachineIdSources {
  platform: NodeJS.Platform;
  readFile: (filePath: string) => Promise<string>;
  execFile: (file: string, args: string[]) => Promise<string>;
  /** Windows `%SystemRoot%`; `C:\Windows` when absent. */
  systemRoot?: string;
}

export const MACHINE_ID_SOURCES = Symbol('MACHINE_ID_SOURCES');

const LINUX_MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
/**
 * Shortest identifier accepted. Real ids are far longer (Linux machine-id: 32
 * hex chars; Windows MachineGuid / macOS IOPlatformUUID: 36-char UUIDs). The
 * floor rejects empty, truncated or placeholder values that would make many
 * machines share one fingerprint.
 */
const MIN_MACHINE_ID_LENGTH = 16;
const EXEC_TIMEOUT_MS = 5000;
/** Absolute paths: never resolve these tools through PATH. */
const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';
const MACOS_IOREG_PATH = '/usr/sbin/ioreg';

function defaultSources(): MachineIdSources {
  return {
    platform: process.platform,
    systemRoot: process.env.SystemRoot,
    readFile: (filePath) => fs.promises.readFile(filePath, 'utf8'),
    execFile: (file, args) =>
      new Promise<string>((resolve, reject) => {
        execFileCallback(
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

/**
 * THE machine id normalization (trim + lowercase), applied once when the id is
 * read and again (idempotently) before hashing, so case or whitespace changes
 * in the OS output never change the fingerprint.
 */
export function normalizeMachineId(id: string): string {
  return id.trim().toLowerCase();
}

function assertPlausible(id: string | undefined, source: string): string {
  const normalized = normalizeMachineId(id ?? '');
  if (normalized.length < MIN_MACHINE_ID_LENGTH) {
    throw new Error(`Machine identifier from ${source} is missing or invalid`);
  }
  return normalized;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runProbe(
  src: MachineIdSources,
  file: string,
  args: string[],
  label: string,
): Promise<string> {
  try {
    return await src.execFile(file, args);
  } catch (error) {
    throw new Error(`Could not query ${label}: ${messageOf(error)}`, {
      cause: error,
    });
  }
}

/**
 * Reads a stable machine identifier, normalized (see `normalizeMachineId`).
 * Deliberately ignores hostname and MAC addresses (both change too easily).
 * Throws when nothing can be read: the caller must treat that as "license
 * invalid" (fail closed).
 */
export async function readMachineId(src: MachineIdSources): Promise<string> {
  switch (src.platform) {
    case 'linux': {
      const errors: unknown[] = [];
      for (const p of LINUX_MACHINE_ID_PATHS) {
        try {
          return assertPlausible(await src.readFile(p), p);
        } catch (error) {
          errors.push(error);
        }
      }
      const detail = LINUX_MACHINE_ID_PATHS.map(
        (p, i) => `${p}: ${messageOf(errors[i])}`,
      ).join('; ');
      throw new Error(`No readable machine-id on this Linux host (${detail})`, {
        cause: errors,
      });
    }
    case 'win32': {
      const regExe = path.win32.join(
        src.systemRoot ?? DEFAULT_SYSTEM_ROOT,
        'System32',
        'reg.exe',
      );
      // `/reg:64` reads the 64-bit view even from a 32-bit node process
      // (WOW64 redirection would otherwise hide/alter the key).
      const out = await runProbe(
        src,
        regExe,
        [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid',
          '/reg:64',
        ],
        'MachineGuid',
      );
      const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out);
      return assertPlausible(match?.[1], 'MachineGuid');
    }
    case 'darwin': {
      const out = await runProbe(
        src,
        MACOS_IOREG_PATH,
        ['-rd1', '-c', 'IOPlatformExpertDevice'],
        'IOPlatformUUID',
      );
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
  const normalized = normalizeMachineId(machineId);
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
  private inFlight: Promise<string> | null = null;

  constructor(
    @Optional() @Inject(MACHINE_ID_SOURCES) sources?: MachineIdSources,
  ) {
    this.sources = sources ?? defaultSources();
  }

  /**
   * Cached after the first success. Concurrent callers share one in-flight
   * probe; a failure is not cached, so the next call probes again.
   */
  getFingerprint(): Promise<string> {
    if (this.cached) return Promise.resolve(this.cached);
    if (!this.inFlight) {
      this.inFlight = readMachineId(this.sources)
        .then((machineId) => {
          this.cached = computeHardwareFingerprint(
            this.sources.platform,
            machineId,
          );
          return this.cached;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }
}
