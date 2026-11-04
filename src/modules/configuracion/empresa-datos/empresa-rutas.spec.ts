import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { EmpresaDatosController } from './empresa-datos.controller';
import { EmpresaController } from '../../clientes y provedores/empresa/empresa.controller';

const RAIZ_MODULOS = join(__dirname, '..', '..');

function archivosControlador(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosControlador(ruta);
    return nombre.endsWith('.controller.ts') ? [ruta] : [];
  });
}

/** Ruta base declarada con `@Controller('x')` en cada archivo (lectura estática: no carga los módulos). */
function rutasBase(): { archivo: string; base: string }[] {
  return archivosControlador(RAIZ_MODULOS).flatMap((archivo) => {
    const coincidencia = /@Controller\(\s*['"]([^'"]+)['"]\s*\)/.exec(
      readFileSync(archivo, 'utf8'),
    );
    return coincidencia
      ? [{ archivo: relative(RAIZ_MODULOS, archivo), base: coincidencia[1] }]
      : [];
  });
}

describe('rutas /empresa (configuración) y /empresas (clientes y proveedores)', () => {
  it('los datos de la empresa son el único controlador en /empresa', () => {
    expect(Reflect.getMetadata('path', EmpresaDatosController)).toBe('empresa');
    const dueños = rutasBase().filter((r) => r.base === 'empresa');
    expect(dueños.map((r) => r.archivo)).toEqual([
      join('configuracion', 'empresa-datos', 'empresa-datos.controller.ts'),
    ]);
  });

  it('el listado de empresas clientes/proveedores vive en /empresas', () => {
    expect(Reflect.getMetadata('path', EmpresaController)).toBe('empresas');
  });

  it('ninguna ruta base está registrada por dos controladores', () => {
    const porBase = new Map<string, string[]>();
    for (const { archivo, base } of rutasBase()) {
      porBase.set(base, [...(porBase.get(base) ?? []), archivo]);
    }
    const repetidas = [...porBase.entries()]
      .filter(([, archivos]) => archivos.length > 1)
      .map(([base, archivos]) => `${base}: ${archivos.join(', ')}`);
    expect(repetidas).toEqual([]);
  });
});
