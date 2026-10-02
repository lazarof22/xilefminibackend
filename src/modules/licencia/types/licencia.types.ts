import type { LicenciaTipo } from '../services/payload-builder';
import type { EstadoCodigo } from '../utils/licencia-estado.util';

/**
 * Full, derived license status. Only returned by admin endpoints; public and
 * user endpoints get reduced projections.
 */
export interface EstadoLicencia {
  valida: boolean;
  estado: EstadoCodigo;
  license_id: string | null;
  empresa_id: string | null;
  tipo: LicenciaTipo | null;
  perpetua: boolean;
  fecha_inicio: string | null;
  fecha_vencimiento: string | null;
  dias_restantes: number | null;
  max_usuarios: number | null;
  secuencia: number | null;
  emitida_en: string | null;
  activa: boolean | null;
  revocada: boolean | null;
}

/** `GET /licencia/public/estado` — no details, no day counts, no skew. */
export interface EstadoPublicoResponse {
  valida: boolean;
  estado: EstadoCodigo;
}

/** `GET /licencia/estado` — authenticated, any role. */
export interface EstadoUsuarioResponse {
  valida: boolean;
  estado: EstadoCodigo;
  tipo: LicenciaTipo | null;
  perpetua: boolean;
  fecha_vencimiento: string | null;
  dias_restantes: number | null;
}

/** Unsigned activation request (`.req`) handed to XILEF. */
export interface SolicitudLicencia {
  version: number;
  empresa_id: string;
  hardware_fingerprint: string;
  generada_en: string;
}

export type ResultadoImportacion =
  'activada' | 'actualizada' | 'revocada' | 'reimportada';

export interface ImportacionResponse {
  mensaje: string;
  resultado: ResultadoImportacion;
  licencia: EstadoLicencia;
}

export interface LicenciaAdminResponse extends EstadoLicencia {
  importada_en: string;
}

export type ImportRejectCode =
  | 'version_no_soportada'
  | 'formato_invalido'
  | 'firma_invalida'
  | 'hardware_no_coincide'
  | 'empresa_no_coincide'
  | 'reloj_alterado'
  | 'estado_alterado'
  | 'expirada'
  | 'secuencia_obsoleta'
  | 'archivo_no_escrito'
  | 'error_interno';

/** Body of every license rejection (HTTP 4xx/5xx). */
export interface LicenciaErrorBody {
  statusCode: number;
  message: string;
  codigo: ImportRejectCode | 'cupo_usuarios_excedido';
}

export interface ContextoPeticion {
  empresaIdUsuario?: string;
  ip?: string;
  userAgent?: string;
}
