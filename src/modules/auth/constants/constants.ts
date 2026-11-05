/** Valor que usaban las versiones anteriores cuando faltaba `JWT_SECRET`; ya no se acepta. */
const JWT_SECRET_ANTIGUO_POR_DEFECTO = 'Chimuelo';

/**
 * Clave con la que se firman y verifican los tokens. Se lee al usarla (no al
 * importar este archivo) para que el `.env` ya esté cargado, y la aplicación
 * no arranca sin una clave propia: con una clave conocida cualquiera podría
 * fabricar un token de administrador.
 */
export function obtenerJwtSecret(): string {
  const secreto = process.env.JWT_SECRET?.trim();
  if (!secreto || secreto === JWT_SECRET_ANTIGUO_POR_DEFECTO) {
    throw new Error(
      'JWT_SECRET no está configurado. Defina en el .env una cadena larga y aleatoria (vea .env.example).',
    );
  }
  return secreto;
}

// NOTE: se mantiene el literal '1h' como tipo para no romper JwtSignOptions
// (jsonwebtoken v9 espera StringValue|number); el env solo aporta el valor.
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '1h') as '1h';
