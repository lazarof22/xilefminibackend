/**
 * Shape of `request.user` after `JwtAuthGuard` (passport-jwt) runs, as
 * returned by `JwtStrategy.validate` (see
 * `src/modules/auth/strategies/jwt.strategies.ts`). Kept minimal and
 * exported here so any controller that needs the authenticated user can
 * reuse a single typed shape instead of redefining it (no `any`).
 */
export interface JwtUser {
  userId: string;
  correo_empleado: string;
  rol: string;
  empresa_id?: string;
}

/** An Express request after `JwtAuthGuard` has attached the JWT user. */
export interface RequestWithUser {
  user: JwtUser;
}
