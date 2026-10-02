import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AuditoriaLicencia,
  AuditoriaLicenciaDocument,
} from '../schemas/auditoria-licencia.schema';
import type { LicenciaAuditAccion } from '../constants/licencia.constants';

export interface AuditQueryParams {
  limit?: number;
  offset?: number;
  empresa_id?: string;
  accion?: string;
}

export interface AuditEntry {
  licencia_id?: Types.ObjectId;
  license_id?: string;
  accion: LicenciaAuditAccion;
  empresa_id?: string;
  detalles?: Record<string, unknown>;
  exitoso: boolean;
  error?: string;
  ip_origen?: string;
  user_agent?: string;
}

/**
 * Audit trail. Detailed reasons (codes, clock values, expiry) live HERE and in
 * admin endpoints only — never in public responses.
 */
@Injectable()
export class LicenciaAuditService {
  private static readonly MAX_LIMIT = 100;
  private static readonly DEFAULT_LIMIT = 100;
  private readonly logger = new Logger(LicenciaAuditService.name);

  constructor(
    @InjectModel(AuditoriaLicencia.name)
    private readonly auditoriaModel: Model<AuditoriaLicenciaDocument>,
  ) {}

  async logAccion(params: AuditEntry): Promise<void> {
    try {
      await this.auditoriaModel.create({
        licencia_id: params.licencia_id,
        license_id: params.license_id,
        accion: params.accion,
        empresa_id: params.empresa_id,
        detalles: params.detalles ?? {},
        exitoso: params.exitoso,
        error: params.error ?? undefined,
        ip_origen: params.ip_origen ?? undefined,
        user_agent: params.user_agent ?? undefined,
      });
    } catch (error) {
      // Audit must never change the license decision.
      this.logger.error('Failed to write license audit entry', error);
    }
  }

  async getAuditoriaPorLicencia(
    licenciaId: Types.ObjectId,
  ): Promise<AuditoriaLicenciaDocument[]> {
    return this.auditoriaModel
      .find({ licencia_id: licenciaId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  /**
   * Paginated audit listing. `limit` is clamped to 100 (default 100); `offset`
   * defaults to 0. Optional filters: `empresa_id`, `accion`.
   */
  async getTodasAuditorias(
    params: AuditQueryParams = {},
  ): Promise<AuditoriaLicenciaDocument[]> {
    const limit = Math.max(
      1,
      Math.min(
        LicenciaAuditService.MAX_LIMIT,
        params.limit ?? LicenciaAuditService.DEFAULT_LIMIT,
      ),
    );
    const offset = Math.max(0, params.offset ?? 0);
    const filter: Record<string, unknown> = {};
    if (params.empresa_id) filter.empresa_id = params.empresa_id;
    if (params.accion) filter.accion = params.accion;
    return this.auditoriaModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
      .exec();
  }

  async getIntentosRechazados(horas = 24): Promise<number> {
    const desde = new Date(Date.now() - horas * 60 * 60 * 1000);
    return this.auditoriaModel.countDocuments({
      accion: 'rechazo',
      exitoso: false,
      createdAt: { $gte: desde },
    });
  }
}
