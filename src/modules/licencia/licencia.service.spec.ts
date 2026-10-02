import * as crypto from 'crypto';
import { HttpException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { LicenciaService } from './licencia.service';
import { LicenciaDocument } from './schemas/licencia.schema';
import { LicenciaCryptoService } from './services/licencia-crypto.service';
import { HardwareFingerprintService } from './services/hardware-fingerprint.service';
import {
  ClockObservation,
  LicenciaClockService,
} from './services/licencia-clock.service';
import { LicenciaAuditService } from './services/licencia-audit.service';
import { LicenciaOfflineService } from './services/licencia-offline.service';
import {
  buildCanonicalPayload,
  LicenciaArtifactV3,
  LicenciaPayloadV3,
} from './services/payload-builder';

const FP = 'a'.repeat(64);
const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const LICENSE_ID = '3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f';

interface StoredDoc {
  _id: Types.ObjectId;
  license_id: string;
  empresa_id: string;
  secuencia: number;
  emitida_en: Date;
  version_firma: number;
  payload: LicenciaPayloadV3;
  firma: string;
  importada_en: Date;
  ultimo_visto_ms: number;
}

interface Chain<T> {
  sort: () => Chain<T>;
  lean: () => Chain<T>;
  exec: () => Promise<T>;
}

function chain<T>(fn: () => T): Chain<T> {
  const c: Chain<T> = {
    sort: () => c,
    lean: () => c,
    exec: () => Promise.resolve().then(fn),
  };
  return c;
}

function matches(doc: StoredDoc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(
    ([k, v]) => (doc as unknown as Record<string, unknown>)[k] === v,
  );
}

class FakeLicenciaModel {
  docs: StoredDoc[] = [];
  failReads = false;

  find(filter: Record<string, unknown>): Chain<StoredDoc[]> {
    return chain(() => {
      if (this.failReads) throw new Error('mongo down');
      return this.docs
        .filter((d) => matches(d, filter))
        .sort((a, b) => b.emitida_en.getTime() - a.emitida_en.getTime())
        .map((d) => structuredClone(d));
    });
  }

  findOne(filter: Record<string, unknown>): Chain<StoredDoc | null> {
    return chain(() => {
      if (this.failReads) throw new Error('mongo down');
      const d = this.docs.find((x) => matches(x, filter));
      return d ? structuredClone(d) : null;
    });
  }

  create(doc: Omit<StoredDoc, '_id'>): Promise<StoredDoc> {
    if (this.docs.some((d) => d.license_id === doc.license_id)) {
      return Promise.reject(Object.assign(new Error('dup'), { code: 11000 }));
    }
    const stored: StoredDoc = {
      ...structuredClone(doc),
      _id: new Types.ObjectId(),
    };
    this.docs.push(stored);
    return Promise.resolve(stored);
  }

  updateOne(
    filter: Record<string, unknown>,
    update: { $set: Partial<StoredDoc> },
  ): Chain<{ matchedCount: number }> {
    return chain(() => {
      const d = this.docs.find((x) => matches(x, filter));
      if (!d) return { matchedCount: 0 };
      Object.assign(d, structuredClone(update.$set));
      return { matchedCount: 1 };
    });
  }

  updateMany(
    filter: Record<string, unknown>,
    update: { $max: { ultimo_visto_ms: number } },
  ): Chain<{ modifiedCount: number }> {
    return chain(() => {
      let n = 0;
      for (const d of this.docs.filter((x) => matches(x, filter))) {
        if (update.$max.ultimo_visto_ms > d.ultimo_visto_ms) {
          d.ultimo_visto_ms = update.$max.ultimo_visto_ms;
          n++;
        }
      }
      return { modifiedCount: n };
    });
  }
}

const vendor = crypto.generateKeyPairSync('ed25519');
const attacker = crypto.generateKeyPairSync('ed25519');
const vendorRaw = Buffer.from(
  vendor.publicKey.export({ format: 'jwk' }).x as string,
  'base64url',
).toString('base64');

function payload(over: Partial<LicenciaPayloadV3> = {}): LicenciaPayloadV3 {
  return {
    activa: true,
    emitida_en: '2026-05-01T00:00:00.000Z',
    empresa_id: 'EMP-001',
    fecha_inicio: '2026-01-01T00:00:00.000Z',
    fecha_vencimiento: '2027-01-01T00:00:00.000Z',
    hardware_fingerprint: FP,
    license_id: LICENSE_ID,
    max_usuarios: 3,
    revocada: false,
    secuencia: 1,
    tipo: 'suscripcion_anual',
    ...over,
  };
}

function artifact(
  p: LicenciaPayloadV3,
  key: crypto.KeyObject = vendor.privateKey,
): LicenciaArtifactV3 {
  return {
    version_firma: 3,
    payload: p,
    firma: crypto
      .sign(null, Buffer.from(buildCanonicalPayload(p), 'utf8'), key)
      .toString('hex'),
  };
}

function codigoOf(
  fn: () => Promise<unknown>,
): Promise<{ status: number; codigo: string }> {
  return fn().then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => {
      if (!(e instanceof HttpException)) throw e;
      const body = e.getResponse() as { codigo: string };
      return { status: e.getStatus(), codigo: body.codigo };
    },
  );
}

describe('LicenciaService', () => {
  let model: FakeLicenciaModel;
  let hw: { getFingerprint: jest.Mock<Promise<string>, []> };
  let clock: {
    observe: jest.Mock<Promise<ClockObservation>, [number?, (number | null)?]>;
  };
  let audit: { logAccion: jest.Mock; getTodasAuditorias: jest.Mock };
  let offline: { exportarArtefacto: jest.Mock };
  let service: LicenciaService;

  const okClock: ClockObservation = {
    ok: true,
    ahoraMs: NOW,
    ultimoVistoMs: null,
  };

  beforeEach(() => {
    model = new FakeLicenciaModel();
    hw = {
      getFingerprint: jest.fn<Promise<string>, []>().mockResolvedValue(FP),
    };
    clock = {
      observe: jest
        .fn<Promise<ClockObservation>, [number?, (number | null)?]>()
        .mockResolvedValue(okClock),
    };
    audit = {
      logAccion: jest.fn().mockResolvedValue(undefined),
      getTodasAuditorias: jest.fn().mockResolvedValue([]),
    };
    offline = { exportarArtefacto: jest.fn().mockResolvedValue(undefined) };
    service = new LicenciaService(
      model as unknown as Model<LicenciaDocument>,
      new LicenciaCryptoService([vendorRaw]),
      hw as unknown as HardwareFingerprintService,
      clock as unknown as LicenciaClockService,
      audit as unknown as LicenciaAuditService,
      offline as unknown as LicenciaOfflineService,
    );
  });

  function auditActions(): string[] {
    return audit.logAccion.mock.calls.map(
      (c: [{ accion: string }]) => c[0].accion,
    );
  }

  describe('generarSolicitud', () => {
    it('returns the server-computed fingerprint, never a client value', async () => {
      const s = await service.generarSolicitud('EMP-001', {});
      expect(s).toEqual({
        version: 1,
        empresa_id: 'EMP-001',
        hardware_fingerprint: FP,
        generada_en: expect.any(String) as string,
      });
      expect(auditActions()).toContain('solicitud');
    });
  });

  describe('importarLicencia', () => {
    it('activates a valid artifact and exports it to disk', async () => {
      const a = artifact(payload());
      const r = await service.importarLicencia(a, {});
      expect(r.resultado).toBe('activada');
      expect(r.licencia).toMatchObject({
        valida: true,
        estado: 'valida',
        license_id: LICENSE_ID,
      });
      expect(model.docs).toHaveLength(1);
      expect(model.docs[0].payload).toEqual(a.payload);
      expect(offline.exportarArtefacto).toHaveBeenCalledWith(a);
      expect(auditActions()).toContain('activacion');
    });

    it('rejects an untrusted signature', async () => {
      const r = await codigoOf(() =>
        service.importarLicencia(artifact(payload(), attacker.privateKey), {}),
      );
      expect(r).toEqual({ status: 400, codigo: 'firma_invalida' });
      expect(model.docs).toHaveLength(0);
      expect(auditActions()).toContain('rechazo');
    });

    it.each([0, 1, 2])(
      'rejects version_firma %p with version_no_soportada',
      async (v) => {
        const a = { ...artifact(payload()), version_firma: v };
        const r = await codigoOf(() => service.importarLicencia(a, {}));
        expect(r).toEqual({ status: 400, codigo: 'version_no_soportada' });
      },
    );

    it('rejects a license bound to another machine', async () => {
      const a = artifact(payload({ hardware_fingerprint: 'b'.repeat(64) }));
      const r = await codigoOf(() => service.importarLicencia(a, {}));
      expect(r).toEqual({ status: 403, codigo: 'hardware_no_coincide' });
      expect(auditActions()).toContain('hardware_no_coincide');
    });

    it('rejects a license for another empresa than the admin JWT', async () => {
      const r = await codigoOf(() =>
        service.importarLicencia(artifact(payload()), {
          empresaIdUsuario: 'OTHER',
        }),
      );
      expect(r).toEqual({ status: 403, codigo: 'empresa_no_coincide' });
    });

    it('rejects when the clock guard detects tampering', async () => {
      clock.observe.mockResolvedValueOnce({
        ok: false,
        codigo: 'reloj_alterado',
        ahoraMs: NOW,
        ultimoVistoMs: NOW + 1e9,
      });
      const r = await codigoOf(() =>
        service.importarLicencia(artifact(payload()), {}),
      );
      expect(r).toEqual({ status: 403, codigo: 'reloj_alterado' });
      expect(auditActions()).toContain('reloj_alterado');
    });

    it('rejects an artifact issued in the future (clock behind emitida_en)', async () => {
      const a = artifact(payload({ emitida_en: '2026-07-01T00:00:00.000Z' }));
      const r = await codigoOf(() => service.importarLicencia(a, {}));
      expect(r).toEqual({ status: 403, codigo: 'reloj_alterado' });
    });

    it('rejects an expired non-revocation artifact', async () => {
      const a = artifact(
        payload({
          fecha_inicio: '2025-01-01T00:00:00.000Z',
          fecha_vencimiento: '2026-02-01T00:00:00.000Z',
          emitida_en: '2025-01-01T00:00:00.000Z',
        }),
      );
      const r = await codigoOf(() => service.importarLicencia(a, {}));
      expect(r).toEqual({ status: 400, codigo: 'expirada' });
    });

    it('treats re-import of the identical artifact as idempotent', async () => {
      const a = artifact(payload());
      await service.importarLicencia(a, {});
      const r = await service.importarLicencia(a, {});
      expect(r.resultado).toBe('reimportada');
      expect(model.docs).toHaveLength(1);
    });

    it('rejects a lower secuencia (anti-rollback)', async () => {
      await service.importarLicencia(artifact(payload({ secuencia: 2 })), {});
      const r = await codigoOf(() =>
        service.importarLicencia(artifact(payload({ secuencia: 1 })), {}),
      );
      expect(r).toEqual({ status: 409, codigo: 'secuencia_obsoleta' });
      expect(auditActions()).toContain('rollback_rechazado');
      expect(model.docs[0].secuencia).toBe(2);
    });

    it('rejects an equal secuencia with a different signature', async () => {
      await service.importarLicencia(
        artifact(payload({ max_usuarios: 3 })),
        {},
      );
      const r = await codigoOf(() =>
        service.importarLicencia(artifact(payload({ max_usuarios: 99 })), {}),
      );
      expect(r).toEqual({ status: 409, codigo: 'secuencia_obsoleta' });
    });

    it('accepts a higher secuencia renewal', async () => {
      await service.importarLicencia(artifact(payload()), {});
      const r = await service.importarLicencia(
        artifact(
          payload({
            secuencia: 2,
            fecha_vencimiento: '2028-01-01T00:00:00.000Z',
          }),
        ),
        {},
      );
      expect(r.resultado).toBe('actualizada');
      expect(r.licencia.fecha_vencimiento).toBe('2028-01-01T00:00:00.000Z');
    });

    it('accepts a signed revocation with higher secuencia and revokes', async () => {
      await service.importarLicencia(artifact(payload()), {});
      const r = await service.importarLicencia(
        artifact(payload({ secuencia: 2, revocada: true, activa: false })),
        {},
      );
      expect(r.resultado).toBe('revocada');
      expect(r.licencia).toMatchObject({ valida: false, estado: 'revocada' });
      expect(auditActions()).toContain('revocacion');
      // the old, active artifact cannot be replayed afterwards
      const replay = await codigoOf(() =>
        service.importarLicencia(artifact(payload()), {}),
      );
      expect(replay.codigo).toBe('secuencia_obsoleta');
    });

    it('surfaces .lic write failures', async () => {
      offline.exportarArtefacto.mockRejectedValueOnce(new Error('EACCES'));
      const r = await codigoOf(() =>
        service.importarLicencia(artifact(payload()), {}),
      );
      expect(r).toEqual({ status: 500, codigo: 'archivo_no_escrito' });
    });

    it('fails closed when the fingerprint cannot be computed', async () => {
      hw.getFingerprint.mockRejectedValue(new Error('no machine id'));
      const r = await codigoOf(() =>
        service.importarLicencia(artifact(payload()), {}),
      );
      expect(r).toEqual({ status: 500, codigo: 'error_interno' });
      expect(model.docs).toHaveLength(0);
    });
  });

  describe('verificarEstado', () => {
    it('reports sin_licencia when nothing was imported', async () => {
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: false,
        estado: 'sin_licencia',
      });
    });

    it('derives validity from the signed payload', async () => {
      await service.importarLicencia(artifact(payload()), {});
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: true,
        estado: 'valida',
        max_usuarios: 3,
        dias_restantes: 214,
      });
    });

    it('ignores tampered database fields (signature re-verified on every check)', async () => {
      await service.importarLicencia(artifact(payload()), {});
      model.docs[0].payload = { ...model.docs[0].payload, max_usuarios: 1000 };
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: false,
        estado: 'firma_invalida',
        max_usuarios: null,
      });
    });

    it('is invalid after expiry, with no grace period', async () => {
      await service.importarLicencia(artifact(payload()), {});
      clock.observe.mockResolvedValue({
        ok: true,
        ahoraMs: Date.parse('2027-01-01T00:00:01.000Z'),
        ultimoVistoMs: NOW,
      });
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: false,
        estado: 'expirada',
        dias_restantes: 0,
      });
    });

    it('keeps perpetual licenses valid', async () => {
      await service.importarLicencia(
        artifact(payload({ tipo: 'perpetua', fecha_vencimiento: null })),
        {},
      );
      clock.observe.mockResolvedValue({
        ok: true,
        ahoraMs: Date.parse('2090-01-01T00:00:00.000Z'),
        ultimoVistoMs: NOW,
      });
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: true,
        perpetua: true,
        dias_restantes: null,
        fecha_vencimiento: null,
      });
    });

    it('is invalid when the clock guard fails', async () => {
      await service.importarLicencia(artifact(payload()), {});
      clock.observe.mockResolvedValue({
        ok: false,
        codigo: 'estado_alterado',
        ahoraMs: NOW,
        ultimoVistoMs: null,
      });
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: false,
        estado: 'estado_alterado',
      });
    });

    it('passes the stored max ultimo_visto_ms as an extra clock floor', async () => {
      await service.importarLicencia(artifact(payload()), {});
      model.docs[0].ultimo_visto_ms = NOW + 5;
      await service.verificarEstado('EMP-001');
      expect(clock.observe).toHaveBeenLastCalledWith(
        expect.any(Number),
        NOW + 5,
      );
    });

    it('fails closed on database errors (no .lic fallback)', async () => {
      await service.importarLicencia(artifact(payload()), {});
      model.failReads = true;
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: false,
        estado: 'error_interno',
      });
    });

    it('fails closed when the fingerprint cannot be computed', async () => {
      await service.importarLicencia(artifact(payload()), {});
      hw.getFingerprint.mockRejectedValue(new Error('no machine id'));
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: false,
        estado: 'error_interno',
      });
    });

    it('scopes by empresa', async () => {
      await service.importarLicencia(artifact(payload()), {});
      expect((await service.verificarEstado('OTHER')).estado).toBe(
        'sin_licencia',
      );
    });

    it('prefers any valid license over a newer revoked one', async () => {
      await service.importarLicencia(artifact(payload()), {});
      const other = '00000000-0000-4000-8000-000000000001';
      await service.importarLicencia(
        artifact(
          payload({
            license_id: other,
            revocada: true,
            activa: false,
            emitida_en: '2026-05-20T00:00:00.000Z',
          }),
        ),
        {},
      );
      expect(await service.verificarEstado('EMP-001')).toMatchObject({
        valida: true,
        license_id: LICENSE_ID,
      });
    });
  });

  describe('public and user projections', () => {
    it('public status only exposes valida and estado', async () => {
      await service.importarLicencia(artifact(payload()), {});
      expect(await service.estadoPublico()).toEqual({
        valida: true,
        estado: 'valida',
      });
    });

    it('user status hides details of invalid licenses', async () => {
      await service.importarLicencia(artifact(payload()), {});
      clock.observe.mockResolvedValue({
        ok: true,
        ahoraMs: Date.parse('2027-03-01T00:00:00.000Z'),
        ultimoVistoMs: NOW,
      });
      expect(await service.estadoUsuario('EMP-001')).toEqual({
        valida: false,
        estado: 'expirada',
        tipo: null,
        perpetua: false,
        fecha_vencimiento: null,
        dias_restantes: null,
      });
    });
  });

  describe('assertCupoUsuarios', () => {
    it('does not block when there is no license yet', async () => {
      await expect(
        service.assertCupoUsuarios('EMP-001', 50),
      ).resolves.toBeUndefined();
    });

    it('allows users below the cap', async () => {
      await service.importarLicencia(
        artifact(payload({ max_usuarios: 3 })),
        {},
      );
      await expect(
        service.assertCupoUsuarios('EMP-001', 2),
      ).resolves.toBeUndefined();
    });

    it('rejects when the cap is reached', async () => {
      await service.importarLicencia(
        artifact(payload({ max_usuarios: 3 })),
        {},
      );
      const r = await codigoOf(() => service.assertCupoUsuarios('EMP-001', 3));
      expect(r).toEqual({ status: 403, codigo: 'cupo_usuarios_excedido' });
    });

    it('treats max_usuarios 0 as unlimited', async () => {
      await service.importarLicencia(
        artifact(payload({ max_usuarios: 0 })),
        {},
      );
      await expect(
        service.assertCupoUsuarios('EMP-001', 10_000),
      ).resolves.toBeUndefined();
    });
  });

  describe('admin listing and cron', () => {
    it('lists licenses with derived status', async () => {
      await service.importarLicencia(artifact(payload()), {});
      const all = await service.findAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        estado: 'valida',
        license_id: LICENSE_ID,
      });
      expect(typeof all[0].importada_en).toBe('string');
    });

    it('findOne returns null when the empresa has no license', async () => {
      expect(await service.findOne('EMP-404')).toBeNull();
    });

    it('re-derives every license on the cron run', async () => {
      await service.importarLicencia(artifact(payload()), {});
      clock.observe.mockResolvedValue({
        ok: true,
        ahoraMs: Date.parse('2027-03-01T00:00:00.000Z'),
        ultimoVistoMs: NOW,
      });
      const resumen = await service.reevaluarTodas();
      expect(resumen).toEqual({ expirada: 1 });
      expect(auditActions()).toContain('verificacion');
    });
  });
});
