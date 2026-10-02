import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { HardwareFingerprintService } from './hardware-fingerprint.service';
import {
  CLOCK_STATE_HKDF_INFO,
  CLOCK_STATE_HKDF_SALT,
  CLOCK_TOLERANCE_MS,
} from '../constants/licencia.constants';
import { writeFileAtomic } from '../utils/atomic-write.util';
import { resolveStatePath } from '../utils/licencia-paths.util';

export type ClockRejectCode = 'reloj_alterado' | 'estado_alterado';

export type ClockObservation =
  | { ok: true; ahoraMs: number; ultimoVistoMs: number | null }
  | {
      ok: false;
      codigo: ClockRejectCode;
      ahoraMs: number;
      ultimoVistoMs: number | null;
    };

interface ClockStateFile {
  v: 1;
  last_seen_ms: number;
  mac: string;
}

type ReadState =
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'ok'; lastSeenMs: number };

const MAC_HEX = /^[0-9a-f]{64}$/;

/**
 * Monotonic clock guard for an offline install.
 *
 * Keeps `last_seen_ms` in a state file outside MongoDB, authenticated with an
 * HMAC-SHA256 whose key is derived (HKDF) from the hardware fingerprint and an
 * embedded constant. On every observation:
 *   - MAC invalid / corrupt file      -> `estado_alterado`
 *   - now < last_seen - tolerance     -> `reloj_alterado`
 *   - otherwise last_seen = max(last_seen, now), written atomically (0600).
 *
 * HONEST LIMITS: this raises the cost of clock rollback, it does not make it
 * impossible. Someone with root on the box and the binary can derive the key,
 * or delete the state file (then only the signed `emitida_en` floor and the
 * caller-provided floor remain). Treat it as a deterrent, not a guarantee.
 */
@Injectable()
export class LicenciaClockService {
  private readonly logger = new Logger(LicenciaClockService.name);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly hardware: HardwareFingerprintService) {}

  /**
   * @param nowMs current wall clock (injectable for tests)
   * @param pisoMs optional extra floor from other storage (e.g. the max
   *   `ultimo_visto_ms` kept in MongoDB). Unsigned floors can only make the
   *   check stricter, never more permissive.
   */
  observe(
    nowMs: number = Date.now(),
    pisoMs?: number | null,
  ): Promise<ClockObservation> {
    const run = this.queue.then(() => this.observeNow(nowMs, pisoMs ?? null));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async observeNow(
    nowMs: number,
    pisoMs: number | null,
  ): Promise<ClockObservation> {
    const key = await this.deriveKey();
    const statePath = resolveStatePath();
    const state = await this.readState(statePath, key);

    if (state.kind === 'corrupt') {
      return {
        ok: false,
        codigo: 'estado_alterado',
        ahoraMs: nowMs,
        ultimoVistoMs: null,
      };
    }

    const fromFile = state.kind === 'ok' ? state.lastSeenMs : null;
    const floors = [fromFile, pisoMs].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v),
    );
    const ultimoVistoMs = floors.length > 0 ? Math.max(...floors) : null;

    if (ultimoVistoMs !== null && nowMs < ultimoVistoMs - CLOCK_TOLERANCE_MS) {
      this.logger.warn(
        `Clock rollback detected: now=${new Date(nowMs).toISOString()} last_seen=${new Date(ultimoVistoMs).toISOString()}`,
      );
      return {
        ok: false,
        codigo: 'reloj_alterado',
        ahoraMs: nowMs,
        ultimoVistoMs,
      };
    }

    const next = Math.max(ultimoVistoMs ?? nowMs, nowMs);
    if (fromFile === null || next !== fromFile) {
      await this.writeState(statePath, key, next);
    }
    return { ok: true, ahoraMs: nowMs, ultimoVistoMs: fromFile };
  }

  private async deriveKey(): Promise<Buffer> {
    const fingerprint = await this.hardware.getFingerprint();
    return Buffer.from(
      crypto.hkdfSync(
        'sha256',
        Buffer.from(fingerprint, 'utf8'),
        Buffer.from(CLOCK_STATE_HKDF_SALT, 'utf8'),
        Buffer.from(CLOCK_STATE_HKDF_INFO, 'utf8'),
        32,
      ),
    );
  }

  private mac(key: Buffer, lastSeenMs: number): string {
    return crypto
      .createHmac('sha256', key)
      .update(`v1|${lastSeenMs}`)
      .digest('hex');
  }

  private async readState(statePath: string, key: Buffer): Promise<ReadState> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(statePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { kind: 'missing' };
      }
      this.logger.error(`Clock state unreadable: ${(error as Error).message}`);
      return { kind: 'corrupt' };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ClockStateFile> | null;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        parsed.v !== 1 ||
        typeof parsed.last_seen_ms !== 'number' ||
        !Number.isSafeInteger(parsed.last_seen_ms) ||
        parsed.last_seen_ms < 0 ||
        typeof parsed.mac !== 'string' ||
        !MAC_HEX.test(parsed.mac)
      ) {
        return { kind: 'corrupt' };
      }
      const expected = Buffer.from(this.mac(key, parsed.last_seen_ms), 'hex');
      const given = Buffer.from(parsed.mac, 'hex');
      if (!crypto.timingSafeEqual(expected, given)) {
        return { kind: 'corrupt' };
      }
      return { kind: 'ok', lastSeenMs: parsed.last_seen_ms };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  private async writeState(
    statePath: string,
    key: Buffer,
    lastSeenMs: number,
  ): Promise<void> {
    const ms = Math.floor(lastSeenMs);
    const content: ClockStateFile = {
      v: 1,
      last_seen_ms: ms,
      mac: this.mac(key, ms),
    };
    await writeFileAtomic(statePath, JSON.stringify(content));
  }
}
