import type { NextFunction, Request, Response } from 'express';

/** Deepest nesting accepted in a JSON body. Real payloads here are < 10 levels. */
export const PROFUNDIDAD_MAXIMA_JSON = 32;

/**
 * `verify` hook of the JSON body parser: refuses a body nested deeper than
 * {@link PROFUNDIDAD_MAXIMA_JSON}. Without it, thousands of `[` make the validation pipe
 * overflow the stack and the request ends as a generic 500.
 * Brackets inside strings are ignored; the scan is a single pass over the (size-limited) body.
 */
export function verificarProfundidadJson(
  _req: unknown,
  _res: unknown,
  cuerpo: Buffer,
): void {
  let profundidad = 0;
  let enCadena = false;
  let escapado = false;

  for (const byte of cuerpo) {
    if (enCadena) {
      if (escapado) escapado = false;
      else if (byte === 0x5c) escapado = true; // \
      else if (byte === 0x22) enCadena = false; // "
      continue;
    }
    if (byte === 0x22) enCadena = true;
    else if (byte === 0x5b || byte === 0x7b) {
      if (++profundidad > PROFUNDIDAD_MAXIMA_JSON) {
        throw Object.assign(new Error('JSON demasiado anidado'), {
          status: 400,
          type: 'entity.too.deep',
        });
      }
    } else if (byte === 0x5d || byte === 0x7d) profundidad--;
  }
}

const MENSAJES: Record<string, { status: number; message: string }> = {
  'entity.parse.failed': {
    status: 400,
    message: 'El cuerpo de la petición no es un JSON válido',
  },
  'entity.too.deep': {
    status: 400,
    message: 'El JSON de la petición está demasiado anidado',
  },
  'entity.too.large': {
    status: 413,
    message: 'El cuerpo de la petición es demasiado grande',
  },
};

/** Answers body-parser failures as JSON (Express would print an HTML page with a stack). */
export function manejarErrorDeCuerpo(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const tipo = (err as { type?: string } | null)?.type;
  const conocido = tipo ? MENSAJES[tipo] : undefined;
  if (!conocido) {
    next(err);
    return;
  }
  res.status(conocido.status).json({
    statusCode: conocido.status,
    message: conocido.message,
    error: conocido.status === 413 ? 'Payload Too Large' : 'Bad Request',
  });
}
