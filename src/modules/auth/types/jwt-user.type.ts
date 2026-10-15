/**
 * Shape of `request.user` after `JwtAuthGuard` (passport-jwt) runs, as
 * returned by `JwtStrategy.validate` (see
 * `src/modules/auth/strategies/jwt.strategies.ts`). Kept minimal and
 * exported here so any controller that needs the authenticated user can
 * reuse a single typed shape instead of redefining it (no `any`).
 */
export interface JwtUser {
  userId: string;
  nombre: string;
  rol: string;
  /** Módulos habilitados (todos para el administrador). */
  modulos: string[];
  /** Reservado para licencias por empresa; los usuarios actuales no lo llevan. */
  empresa_id?: string;
}

/** An Express request after `JwtAuthGuard` has attached the JWT user. */
export interface RequestWithUser {
  user: JwtUser;
}
