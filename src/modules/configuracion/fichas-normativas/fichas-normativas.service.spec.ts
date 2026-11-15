import { NotFoundException } from '@nestjs/common';
import { FichasNormativasService } from './fichas-normativas.service';

/** Prefixes literally passed to `ConsecutivoService.siguiente` by each module's service. */
const PREFIJOS_REALES: Record<string, string> = {
  'SC-2-04': 'REC', // recepcion.service.ts: siguiente('recepcion', 'REC')
  'SC-2-08': 'DEV', // devolucion.service.ts: PREFIJO_CONSECUTIVO = 'DEV'
  'SC-2-16': 'AJU', // ajuste-inventario.service.ts: siguiente('ajuste', 'AJU')
};

describe('FichasNormativasService', () => {
  const service = new FichasNormativasService();

  it('covers every document type the system produces', () => {
    expect(service.listar().map((f) => f.codigo)).toEqual([
      'SC-2-04',
      'SC-2-08',
      'SC-2-16',
      'SC-3-06',
      'SC-2-13',
    ]);
  });

  it('has unique codes', () => {
    const codigos = service.listar().map((f) => f.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it.each(service.listar().map((f) => [f.codigo, f] as const))(
    '%s has non-empty fields',
    (_codigo, ficha) => {
      for (const texto of [
        ficha.codigo,
        ficha.nombre,
        ficha.norma,
        ficha.moduloApi,
        ficha.numeracion.formato,
      ]) {
        expect(texto.trim()).not.toBe('');
      }
      expect(ficha.camposObligatorios.length).toBeGreaterThan(0);
      ficha.camposObligatorios.forEach((c) => expect(c.trim()).not.toBe(''));
      expect(ficha.moduloApi).toMatch(/^src\/modules\/inventario\//);
    },
  );

  it('only the Kardex sheet has no signature fields', () => {
    for (const f of service.listar()) {
      if (f.codigo === 'SC-2-13') expect(f.firmas).toEqual([]);
      else expect(f.firmas.length).toBeGreaterThan(0);
    }
  });

  it.each(Object.entries(PREFIJOS_REALES))(
    '%s numbering prefix matches the one its module uses (%s)',
    (codigo, prefijo) => {
      const { numeracion } = service.obtener(codigo);
      expect(numeracion.prefijo).toBe(prefijo);
      expect(numeracion.ejemplo).toBe(`${prefijo}-000001`);
      expect(numeracion.formato).toContain(`${prefijo}-NNNNNN`);
    },
  );

  it('documents without an own sequence declare a null prefix and example', () => {
    for (const codigo of ['SC-3-06', 'SC-2-13']) {
      const { numeracion } = service.obtener(codigo);
      expect(numeracion.prefijo).toBeNull();
      expect(numeracion.ejemplo).toBeNull();
    }
  });

  it('keeps the signature fields of each module DTO', () => {
    expect(service.obtener('SC-2-08').firmas).toEqual([
      'autorizadoPor',
      'recibidoPor',
      'firma',
    ]);
    expect(service.obtener('SC-2-16').firmas).toEqual([
      'autorizadoPor',
      'firmadoPor',
    ]);
    expect(service.obtener('SC-3-06').firmas).toEqual([
      'responsableArqueo',
      'responsableCustodia',
      'firmadoPor',
    ]);
    expect(service.obtener('SC-3-06').norma).toBe('Resolución 12/2007');
  });

  it('obtener is case-insensitive and ignores surrounding spaces', () => {
    expect(service.obtener(' sc-2-04 ').codigo).toBe('SC-2-04');
  });

  it('obtener throws NotFoundException for an unknown code', () => {
    expect(() => service.obtener('SC-9-99')).toThrow(NotFoundException);
  });

  it('listar returns a copy: mutating it does not alter the catalog', () => {
    service.listar().pop();
    expect(service.listar()).toHaveLength(5);
  });
});
