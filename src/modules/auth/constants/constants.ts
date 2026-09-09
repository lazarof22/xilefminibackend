export const JWT_SECRET = process.env.JWT_SECRET || 'Chimuelo';
// NOTE: se mantiene el literal '1h' como tipo para no romper JwtSignOptions
// (jsonwebtoken v9 espera StringValue|number); el env solo aporta el valor.
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '1h') as '1h';