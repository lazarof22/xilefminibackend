import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthService } from './auth.service';
import { obtenerJwtSecret } from './constants/constants';
import {
  Usuarios,
  UsuariosDocument,
  UsuarioRol,
} from './schemas/usuarios.schema';

export const ROLES_SUPERVISOR: string[] = [
  UsuarioRol.ADMIN,
  UsuarioRol.GERENTE,
];

export const MENSAJE_EXTRACCION_NO_AUTORIZADA =
  'Solo un administrador o gerente puede autorizar una extracción de caja';

export const MENSAJE_AUTORIZACION_RECHAZADA =
  'Credenciales inválidas o sin permiso para autorizar una extracción de caja';

/** Audiencia del token de autorización: una sesión normal nunca la trae, así que no sirve aquí. */
export const AUDIENCIA_EXTRACCION = 'extraccion';

/** Lo que tarda en vencer la autorización (el cajero rellena el monto y la causa después de que el supervisor entra). */
export const VIGENCIA_AUTORIZACION_SEGUNDOS = 120;

export interface Supervisor {
  userId: string;
  nombre: string;
}

export interface AutorizacionEmitida {
  tokenAutorizador: string;
  autorizadoPor: string;
  venceEnSegundos: number;
}

export const esRolSupervisor = (rol: string | undefined): boolean =>
  rol !== undefined && ROLES_SUPERVISOR.includes(rol);

interface PayloadAutorizacion {
  sub?: unknown;
  /** Usuario de sesión (el cajero) para quien se emitió; solo él puede usarla. */
  act?: unknown;
  jti?: unknown;
}

/**
 * Autorización de un supervisor (administrador o gerente) para que otro
 * usuario con sesión propia haga una acción restringida (p. ej. extraer
 * efectivo, doc §6.9).
 *
 * El supervisor entrega sus credenciales una vez (`emitir`) y recibe un token
 * propio de esta acción: vence en pocos minutos, solo vale para el usuario de
 * sesión al que se emitió y se consume al usarse (`verificar`). Así el cajero
 * nunca maneja la sesión del supervisor, y un token copiado no abre el resto
 * de la API. El rol se vuelve a leer de la base de datos al verificar. Nada
 * de esto se registra ni se guarda.
 */
@Injectable()
export class AutorizadorSupervisorService {
  /** `jti` ya usados con su vencimiento (ms); se descartan al vencer. */
  private readonly consumidos = new Map<string, number>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    @InjectModel(Usuarios.name)
    private readonly userModel: Model<UsuariosDocument>,
  ) {}

  async emitir(
    nombre: string,
    contraseña: string,
    actorUserId: string,
  ): Promise<AutorizacionEmitida> {
    const supervisor = await this.authService.validateUser(nombre, contraseña);
    if (!supervisor || !esRolSupervisor(supervisor.rol)) {
      throw new ForbiddenException(MENSAJE_AUTORIZACION_RECHAZADA);
    }
    const tokenAutorizador = await this.jwtService.signAsync(
      { sub: String(supervisor._id), act: actorUserId },
      {
        secret: obtenerJwtSecret(),
        audience: AUDIENCIA_EXTRACCION,
        expiresIn: VIGENCIA_AUTORIZACION_SEGUNDOS,
        jwtid: randomUUID(),
      },
    );
    return {
      tokenAutorizador,
      autorizadoPor: supervisor.nombre,
      venceEnSegundos: VIGENCIA_AUTORIZACION_SEGUNDOS,
    };
  }

  /** Verifica y CONSUME la autorización; `actorUserId` es quien la usa. */
  async verificar(token: string, actorUserId: string): Promise<Supervisor> {
    let payload: PayloadAutorizacion;
    try {
      payload = await this.jwtService.verifyAsync<PayloadAutorizacion>(token, {
        secret: obtenerJwtSecret(),
        audience: AUDIENCIA_EXTRACCION,
      });
    } catch {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string' ||
      payload.act !== actorUserId
    ) {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    this.consumir(payload.jti);

    const user = await this.userModel.findById(payload.sub).lean().exec();
    if (!user || !esRolSupervisor(user.rol)) {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    return { userId: String(user._id), nombre: user.nombre };
  }

  /** Marca el `jti` como usado; si ya lo estaba, la autorización no se reutiliza. */
  private consumir(jti: string): void {
    const ahora = Date.now();
    for (const [id, vence] of this.consumidos) {
      if (vence <= ahora) this.consumidos.delete(id);
    }
    if (this.consumidos.has(jti)) {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    this.consumidos.set(
      jti,
      ahora + (VIGENCIA_AUTORIZACION_SEGUNDOS + 5) * 1000,
    );
  }
}
