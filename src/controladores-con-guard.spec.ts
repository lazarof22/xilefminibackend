import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

/**
 * Every route of every controller must require a JWT, except the ones listed here on purpose.
 * A new controller (or handler) without `@UseGuards(JwtAuthGuard)` fails this test, so the
 * "forgot the guard" mistake cannot come back.
 *
 * Key: `Controlador.metodo`. The reason is part of the entry.
 */
const PUBLICAS: Record<string, string> = {
  'AppController.getHello': 'health check',
  'AuthController.login': 'it is the login (LocalAuthGuard)',
  'LicenciaController.estadoPublico': 'public status: only { valida, estado }',
  'EmpresaDatosController.obtener':
    'company name and logo for the login screen',
};

const GUARDS = '__guards__';
const METHOD = 'method';
const PATH = 'path';

function archivosControlador(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return archivosControlador(ruta);
    return e.name.endsWith('.controller.ts') ? [ruta] : [];
  });
}

function guardsDe(destino: object): unknown[] {
  return (Reflect.getMetadata(GUARDS, destino) as unknown[] | undefined) ?? [];
}

describe('every controller route requires a JWT', () => {
  const archivos = archivosControlador(path.join(__dirname, 'modules')).concat(
    path.join(__dirname, 'app.controller.ts'),
  );

  const sinGuard: string[] = [];
  let rutasVistas = 0;
  const publicasVistas: string[] = [];
  const controladores: string[] = [];

  for (const archivo of archivos) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modulo = require(archivo) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (typeof exportado !== 'function') continue;
      if (Reflect.getMetadata(PATH, exportado) === undefined) continue;
      controladores.push(exportado.name);

      const enClase = guardsDe(exportado).includes(JwtAuthGuard);
      for (const nombre of Object.getOwnPropertyNames(exportado.prototype)) {
        const handler = (exportado.prototype as Record<string, unknown>)[
          nombre
        ];
        if (typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD, handler) === undefined) continue;

        rutasVistas++;
        const clave = `${exportado.name}.${nombre}`;
        if (enClase || guardsDe(handler).includes(JwtAuthGuard)) continue;
        if (clave in PUBLICAS) {
          publicasVistas.push(clave);
          continue;
        }
        sinGuard.push(clave);
      }
    }
  }

  it('found the controllers (the scan itself works)', () => {
    expect(controladores.length).toBeGreaterThan(40);
    expect(rutasVistas).toBeGreaterThan(200);
    expect(publicasVistas.sort()).toEqual(Object.keys(PUBLICAS).sort());
  });

  it('no route is left without JwtAuthGuard (outside the documented public list)', () => {
    expect(sinGuard).toEqual([]);
  });

  it('the public list has no stale entries', () => {
    const existentes = new Set<string>();
    for (const archivo of archivos) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const modulo = require(archivo) as Record<string, unknown>;
      for (const exportado of Object.values(modulo)) {
        if (typeof exportado !== 'function') continue;
        for (const nombre of Object.getOwnPropertyNames(
          exportado.prototype ?? {},
        ))
          existentes.add(`${exportado.name}.${nombre}`);
      }
    }
    expect(Object.keys(PUBLICAS).filter((k) => !existentes.has(k))).toEqual([]);
  });
});
