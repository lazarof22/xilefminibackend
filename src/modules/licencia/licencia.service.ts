import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Licencia, LicenciaDocument } from './schemas/licencia.schema';
import { LicenciaCryptoService } from './services/licencia-crypto.service';
import { HardwareFingerprintService } from './services/hardware-fingerprint.service';
import { LicenciaClockService } from './services/licencia-clock.service';
import { LicenciaAuditService } from './services/licencia-audit.service';
import type { AuditEntry } from './services/licencia-audit.service';
import { LicenciaOfflineService } from './services/licencia-offline.service';
import {
  LicenciaArtifactV3,
  LicenciaPayloadV3,
} from './services/payload-builder';
import {
  FIRMA_VERSION_ACTUAL,
  SOLICITUD_VERSION,
} from './constants/licencia.constants';
import type { LicenciaAuditAccion } from './constants/licencia.constants';
import {
  ContextoEvaluacion,
  derivarCodigo,
  diasRestantes,
  EstadoCodigo,
} from './utils/licencia-estado.util';
import type {
  ContextoPeticion,
  EstadoLicencia,
  EstadoPublicoResponse,
  EstadoUsuarioResponse,
  ImportacionResponse,
  ImportRejectCode,
  LicenciaAdminResponse,
  LicenciaErrorBody,
  ResultadoImportacion,
  SolicitudLicencia,
} from './types/licencia.types';
import type { AuditoriaLicenciaDocument } from './schemas/auditoria-licencia.schema';

/** Plain (lean) shape of a stored license. */
interface LicenciaRecord {
  _id: Types.ObjectId;
  license_id: string;
  empresa_id: string;
  secuencia: number;
  emitida_en: Date;
  version_firma: number;
  payload: LicenciaPayloadV3;
  firma: string;
  importada_en: Date;
  ultimo_visto_ms?: number;
}

interface Evaluacion {
  record: LicenciaRecord;
  estado: EstadoLicencia;
}

const MENSAJE_RECHAZO = 'Licencia rechazada';

const MENSAJES_IMPORTACION: Record<ResultadoImportacion, string> = {
  activada: 'Licencia activada',
  actualizada: 'Licencia actualizada',
  revocada: 'Licencia revocada',
  reimportada: 'Licencia ya importada (sin cambios)',
};

function rechazo(
  status: HttpStatus,
  codigo: LicenciaErrorBody['codigo'],
): HttpException {
  const body: LicenciaErrorBody = {
    statusCode: status,
    message: MENSAJE_RECHAZO,
    codigo,
  };
  return new HttpException(body, status);
}

function estadoVacio(estado: EstadoCodigo): EstadoLicencia {
  return {
    valida: false,
    estado,
    license_id: null,
    empresa_id: null,
    tipo: null,
    perpetua: false,
    fecha_inicio: null,
    fecha_vencimiento: null,
    dias_restantes: null,
    max_usuarios: null,
    secuencia: null,
    emitida_en: null,
    activa: null,
    revocada: null,
  };
}

function estadoDesdePayload(
  p: LicenciaPayloadV3,
  estado: EstadoCodigo,
  ahoraMs: number,
): EstadoLicencia {
  return {
    valida: estado === 'valida',
    estado,
    license_id: p.license_id,
    empresa_id: p.empresa_id,
    tipo: p.tipo,
    perpetua: p.fecha_vencimiento === null,
    fecha_inicio: p.fecha_inicio,
    fecha_vencimiento: p.fecha_vencimiento,
    dias_restantes: diasRestantes(p, ahoraMs),
    max_usuarios: p.max_usuarios,
    secuencia: p.secuencia,
    emitida_en: p.emitida_en,
    activa: p.activa,
    revocada: p.revocada,
  };
}

/** Status codes that mean "security event", worth an audit entry. */
const CODIGOS_AUDITABLES: Partial<Record<EstadoCodigo, LicenciaAuditAccion>> = {
  firma_invalida: 'rechazo',
  formato_invalido: 'rechazo',
  version_no_soportada: 'rechazo',
  hardware_no_coincide: 'hardware_no_coincide',
  reloj_alterado: 'reloj_alterado',
  estado_alterado: 'reloj_alterado',
};

/**
 * License service for an OFFLINE on-prem install.
 *
 * - Import: verifies the signed v3 artifact (embedded trusted keys), the
 *   server-computed hardware fingerprint, empresa, clock and anti-rollback
 *   (`secuencia` per `license_id`), then stores the signed payload VERBATIM.
 * - Status: DERIVED on every check from the stored signed payload + current
 *   time. Unsigned DB fields never make a license valid. Any error → invalid.
 */
@Injectable()
export class LicenciaService {
  private readonly logger = new Logger(LicenciaService.name);

  constructor(
    @InjectModel(Licencia.name)
    private readonly licenciaModel: Model<LicenciaDocument>,
    private readonly cryptoService: LicenciaCryptoService,
    private readonly hardwareService: HardwareFingerprintService,
    private readonly clockService: LicenciaClockService,
    private readonly auditService: LicenciaAuditService,
    private readonly offlineService: LicenciaOfflineService,
  ) {}

  /** Builds the unsigned activation request for XILEF (`.req`). */
  async generarSolicitud(
    empresaId: string,
    ctx: ContextoPeticion,
  ): Promise<SolicitudLicencia> {
    const solicitud: SolicitudLicencia = {
      version: SOLICITUD_VERSION,
      empresa_id: empresaId,
      hardware_fingerprint: await this.hardwareService.getFingerprint(),
      generada_en: new Date().toISOString(),
    };
    await this.audit(
      { accion: 'solicitud', empresa_id: empresaId, exitoso: true },
      ctx,
    );
    return solicitud;
  }

  /** Imports a signed artifact (`POST /licencia/activar`). */
  async importarLicencia(
    artifact: unknown,
    ctx: ContextoPeticion,
  ): Promise<ImportacionResponse> {
    try {
      return await this.importar(artifact, ctx);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`License import failed: ${(error as Error).message}`);
      await this.audit(
        { accion: 'rechazo', exitoso: false, error: 'error_interno' },
        ctx,
      );
      throw rechazo(HttpStatus.INTERNAL_SERVER_ERROR, 'error_interno');
    }
  }

  private async importar(
    artifact: unknown,
    ctx: ContextoPeticion,
  ): Promise<ImportacionResponse> {
    const verificacion = this.cryptoService.verifyArtifact(artifact);
    if (!verificacion.ok) {
      await this.audit(
        { accion: 'rechazo', exitoso: false, error: verificacion.codigo },
        ctx,
      );
      throw rechazo(HttpStatus.BAD_REQUEST, verificacion.codigo);
    }
    const { payload, firma } = verificacion;
    const base: Pick<AuditEntry, 'license_id' | 'empresa_id'> = {
      license_id: payload.license_id,
      empresa_id: payload.empresa_id,
    };

    const fingerprint = await this.hardwareService.getFingerprint();
    const existing = await this.licenciaModel
      .findOne({ license_id: payload.license_id })
      .lean<LicenciaRecord>()
      .exec();

    const clock = await this.clockService.observe(
      Date.now(),
      existing?.ultimo_visto_ms ?? null,
    );
    if (!clock.ok) {
      await this.audit(
        {
          ...base,
          accion: 'reloj_alterado',
          exitoso: false,
          error: clock.codigo,
        },
        ctx,
      );
      throw rechazo(HttpStatus.FORBIDDEN, clock.codigo);
    }

    const codigo = derivarCodigo(payload, {
      ahoraMs: clock.ahoraMs,
      fingerprint,
      empresaId: ctx.empresaIdUsuario,
    });
    const bloqueo = this.bloqueoImportacion(codigo, payload);
    if (bloqueo) {
      await this.audit(
        {
          ...base,
          accion: bloqueo.accion,
          exitoso: false,
          error: bloqueo.codigo,
        },
        ctx,
      );
      throw rechazo(bloqueo.status, bloqueo.codigo);
    }

    const resultado = await this.persistir(
      existing,
      payload,
      firma,
      clock.ahoraMs,
      ctx,
    );
    const stored: LicenciaArtifactV3 = {
      version_firma: FIRMA_VERSION_ACTUAL,
      payload,
      firma,
    };

    try {
      await this.offlineService.exportarArtefacto(stored);
    } catch {
      // Already logged by the offline service. The DB is updated; re-importing
      // the same artifact is idempotent and retries the export.
      throw rechazo(HttpStatus.INTERNAL_SERVER_ERROR, 'archivo_no_escrito');
    }

    const accion: LicenciaAuditAccion =
      resultado === 'revocada'
        ? 'revocacion'
        : resultado === 'reimportada'
          ? 'reimportacion'
          : 'activacion';
    await this.audit(
      {
        ...base,
        accion,
        exitoso: true,
        detalles: { secuencia: payload.secuencia },
      },
      ctx,
    );

    return {
      mensaje: MENSAJES_IMPORTACION[resultado],
      resultado,
      licencia: estadoDesdePayload(payload, codigo, clock.ahoraMs),
    };
  }

  private bloqueoImportacion(
    codigo: EstadoCodigo,
    payload: LicenciaPayloadV3,
  ): {
    status: HttpStatus;
    codigo: ImportRejectCode;
    accion: LicenciaAuditAccion;
  } | null {
    switch (codigo) {
      case 'hardware_no_coincide':
        return {
          status: HttpStatus.FORBIDDEN,
          codigo,
          accion: 'hardware_no_coincide',
        };
      case 'empresa_no_coincide':
        return { status: HttpStatus.FORBIDDEN, codigo, accion: 'rechazo' };
      case 'reloj_alterado':
        return {
          status: HttpStatus.FORBIDDEN,
          codigo,
          accion: 'reloj_alterado',
        };
      case 'expirada':
        return payload.revocada
          ? null
          : { status: HttpStatus.BAD_REQUEST, codigo, accion: 'rechazo' };
      default:
        return null;
    }
  }

  /** Anti-rollback persistence keyed by `license_id`. */
  private async persistir(
    existing: LicenciaRecord | null,
    payload: LicenciaPayloadV3,
    firma: string,
    ahoraMs: number,
    ctx: ContextoPeticion,
  ): Promise<ResultadoImportacion> {
    const campos = {
      license_id: payload.license_id,
      empresa_id: payload.empresa_id,
      secuencia: payload.secuencia,
      emitida_en: new Date(payload.emitida_en),
      version_firma: FIRMA_VERSION_ACTUAL,
      payload,
      firma,
      importada_en: new Date(ahoraMs),
    };
    const rollback = async (detalle: string): Promise<never> => {
      await this.audit(
        {
          license_id: payload.license_id,
          empresa_id: payload.empresa_id,
          accion: 'rollback_rechazado',
          exitoso: false,
          error: detalle,
          detalles: {
            secuencia_recibida: payload.secuencia,
            secuencia_actual: existing?.secuencia ?? null,
          },
        },
        ctx,
      );
      throw rechazo(HttpStatus.CONFLICT, 'secuencia_obsoleta');
    };

    if (!existing) {
      try {
        await this.licenciaModel.create({
          ...campos,
          ultimo_visto_ms: ahoraMs,
        });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          return rollback('concurrent import');
        }
        throw error;
      }
      return payload.revocada ? 'revocada' : 'activada';
    }

    if (existing.empresa_id !== payload.empresa_id) {
      throw rechazo(HttpStatus.FORBIDDEN, 'empresa_no_coincide');
    }
    if (payload.secuencia < existing.secuencia) {
      return rollback('lower secuencia');
    }
    if (payload.secuencia === existing.secuencia) {
      if (existing.firma === firma) return 'reimportada';
      return rollback('same secuencia, different artifact');
    }

    const res = await this.licenciaModel
      .updateOne(
        { license_id: payload.license_id, secuencia: existing.secuencia },
        { $set: campos },
      )
      .exec();
    if (res.matchedCount === 0) {
      return rollback('concurrent update');
    }
    return payload.revocada ? 'revocada' : 'actualizada';
  }

  /**
   * Derived status for an empresa (or the whole install when `empresaId` is
   * undefined). NEVER throws: any error yields `valida: false`.
   */
  async verificarEstado(
    empresaId?: string,
    ctx: ContextoPeticion = {},
  ): Promise<EstadoLicencia> {
    try {
      const evaluaciones = await this.evaluar(empresaId, ctx);
      if (evaluaciones.length === 0) return estadoVacio('sin_licencia');
      const valida = evaluaciones.find((e) => e.estado.valida);
      return (valida ?? evaluaciones[0]).estado;
    } catch (error) {
      this.logger.error(
        `License check failed (fail closed): ${(error as Error).message}`,
      );
      return estadoVacio('error_interno');
    }
  }

  /** Evaluates every stored license in scope, newest `emitida_en` first. */
  private async evaluar(
    empresaId: string | undefined,
    ctx: ContextoPeticion,
  ): Promise<Evaluacion[]> {
    const filter = empresaId !== undefined ? { empresa_id: empresaId } : {};
    const records = await this.licenciaModel
      .find(filter)
      .sort({ emitida_en: -1 })
      .lean<LicenciaRecord[]>()
      .exec();
    if (records.length === 0) return [];

    const fingerprint = await this.hardwareService.getFingerprint();
    const piso = Math.max(0, ...records.map((r) => r.ultimo_visto_ms ?? 0));
    const clock = await this.clockService.observe(
      Date.now(),
      piso > 0 ? piso : null,
    );
    if (!clock.ok) {
      await this.audit(
        {
          accion: 'reloj_alterado',
          empresa_id: empresaId,
          exitoso: false,
          error: clock.codigo,
        },
        ctx,
      );
      return records.map((record) => ({
        record,
        estado: estadoVacio(clock.codigo),
      }));
    }

    await this.licenciaModel
      .updateMany(filter, { $max: { ultimo_visto_ms: clock.ahoraMs } })
      .exec();

    const contexto: ContextoEvaluacion = {
      ahoraMs: clock.ahoraMs,
      fingerprint,
      empresaId,
    };
    const evaluaciones: Evaluacion[] = [];
    for (const record of records) {
      const estado = this.evaluarRegistro(record, contexto);
      const accion = CODIGOS_AUDITABLES[estado.estado];
      if (accion) {
        await this.audit(
          {
            accion,
            license_id: record.license_id,
            empresa_id: record.empresa_id,
            exitoso: false,
            error: estado.estado,
          },
          ctx,
        );
      }
      evaluaciones.push({ record, estado });
    }
    return evaluaciones;
  }

  private evaluarRegistro(
    record: LicenciaRecord,
    ctx: ContextoEvaluacion,
  ): EstadoLicencia {
    const verificacion = this.cryptoService.verifyArtifact({
      version_firma: record.version_firma,
      payload: record.payload,
      firma: record.firma,
    });
    if (!verificacion.ok) return estadoVacio(verificacion.codigo);
    const p = verificacion.payload;
    return estadoDesdePayload(p, derivarCodigo(p, ctx), ctx.ahoraMs);
  }

  /** Minimal unauthenticated projection: no dates, no day counts, no skew. */
  async estadoPublico(): Promise<EstadoPublicoResponse> {
    const estado = await this.verificarEstado();
    return { valida: estado.valida, estado: estado.estado };
  }

  /** Projection for any authenticated user; details only when valid. */
  async estadoUsuario(empresaId?: string): Promise<EstadoUsuarioResponse> {
    const e = await this.verificarEstado(empresaId);
    if (!e.valida) {
      return {
        valida: false,
        estado: e.estado,
        tipo: null,
        perpetua: false,
        fecha_vencimiento: null,
        dias_restantes: null,
      };
    }
    return {
      valida: true,
      estado: e.estado,
      tipo: e.tipo,
      perpetua: e.perpetua,
      fecha_vencimiento: e.fecha_vencimiento,
      dias_restantes: e.dias_restantes,
    };
  }

  /**
   * Enforces `max_usuarios` (0 = unlimited) before creating a user.
   *
   * Only enforced when a VALID license exists. With no license (or an invalid
   * one) user creation is not blocked, because the license guard is
   * intentionally not wired yet; tighten this when guards are wired.
   */
  async assertCupoUsuarios(
    empresaId: string | undefined,
    usuariosActuales: number,
  ): Promise<void> {
    const estado = await this.verificarEstado(empresaId);
    if (!estado.valida) return;
    const max = estado.max_usuarios ?? 0;
    if (max > 0 && usuariosActuales >= max) {
      const body: LicenciaErrorBody = {
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Se alcanzó el máximo de usuarios permitido por la licencia',
        codigo: 'cupo_usuarios_excedido',
      };
      throw new HttpException(body, HttpStatus.FORBIDDEN);
    }
  }

  /** Admin: all stored licenses with derived status. */
  async findAll(): Promise<LicenciaAdminResponse[]> {
    const evaluaciones = await this.evaluar(undefined, {});
    return evaluaciones.map((e) => this.toAdmin(e));
  }

  /** Admin: best license for an empresa (valid first), or null. */
  async findOne(empresaId: string): Promise<LicenciaAdminResponse | null> {
    const evaluaciones = await this.evaluar(empresaId, {});
    if (evaluaciones.length === 0) return null;
    return this.toAdmin(
      evaluaciones.find((e) => e.estado.valida) ?? evaluaciones[0],
    );
  }

  private toAdmin(e: Evaluacion): LicenciaAdminResponse {
    return {
      ...e.estado,
      license_id: e.record.license_id,
      empresa_id: e.record.empresa_id,
      importada_en: new Date(e.record.importada_en).toISOString(),
    };
  }

  /**
   * Cron: re-derives every license from its signed payload (there is no
   * stored `activa` flag to flip) and audits the ones that are not valid.
   * Also advances the monotonic clock state daily.
   */
  async reevaluarTodas(): Promise<Partial<Record<EstadoCodigo, number>>> {
    const evaluaciones = await this.evaluar(undefined, {});
    const resumen: Partial<Record<EstadoCodigo, number>> = {};
    for (const { record, estado } of evaluaciones) {
      resumen[estado.estado] = (resumen[estado.estado] ?? 0) + 1;
      if (!estado.valida) {
        await this.auditService.logAccion({
          accion: 'verificacion',
          license_id: record.license_id,
          empresa_id: record.empresa_id,
          exitoso: false,
          error: estado.estado,
        });
      }
    }
    return resumen;
  }

  async getAuditoria(params?: {
    limit?: number;
    offset?: number;
    empresa_id?: string;
    accion?: string;
  }): Promise<AuditoriaLicenciaDocument[]> {
    return this.auditService.getTodasAuditorias(params ?? {});
  }

  private async audit(entry: AuditEntry, ctx: ContextoPeticion): Promise<void> {
    await this.auditService.logAccion({
      ...entry,
      ip_origen: ctx.ip,
      user_agent: ctx.userAgent,
    });
  }
}
