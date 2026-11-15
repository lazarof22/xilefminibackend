import { BadRequestException } from '@nestjs/common';
import {
  COLECCIONES_PROTEGIDAS_PREFIJOS,
  ImportExportService,
} from './import-export.service';

function crearServicio(existentes: Record<string, Record<string, unknown>[]>) {
  const insertOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const collection = jest.fn((nombre: string) => ({
    find: () => ({
      toArray: () => Promise.resolve(existentes[nombre] ?? []),
    }),
    insertOne: (doc: unknown) => insertOne(nombre, doc),
  }));
  const connection = {
    db: {
      listCollections: () => ({
        toArray: () =>
          Promise.resolve(Object.keys(existentes).map((name) => ({ name }))),
      }),
      collection,
    },
  };
  const servicio = new ImportExportService(
    connection as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { servicio, insertOne, collection };
}

const BD = {
  productos: [{ _id: 1, __v: 0, nombre: 'Arroz' }],
  usuarios: [{ _id: 2, usuario: 'admin', password: '$2b$10$hash' }],
  licencias_v3: [{ _id: 3, clave: 'secreta' }],
  licencias: [{ _id: 4 }],
  auditoria_licencias: [{ _id: 5 }],
  operaciones_idempotentes: [{ _id: 6 }],
  'system.views': [],
};

describe('ImportExportService.exportAllToJson', () => {
  it('never exports users, licenses, license audit nor idempotency collections', async () => {
    const { servicio } = crearServicio(BD);

    const out = await servicio.exportAllToJson();

    expect(Object.keys(out)).not.toEqual(expect.arrayContaining(['usuarios']));
    for (const nombre of [
      'usuarios',
      'licencias_v3',
      'licencias',
      'auditoria_licencias',
      'operaciones_idempotentes',
    ]) {
      expect(out).not.toHaveProperty(nombre);
    }
    expect(JSON.stringify(out)).not.toContain('$2b$10$hash');
  });

  it('keeps exporting ordinary collections without _id and __v', async () => {
    const { servicio } = crearServicio(BD);

    const out = await servicio.exportAllToJson();

    expect(out.productos).toEqual([{ nombre: 'Arroz' }]);
  });

  it('reports which collections were skipped in an additive key', async () => {
    const { servicio } = crearServicio(BD);

    const out = await servicio.exportAllToJson();

    expect([...(out.__omitidas as string[])].sort()).toEqual(
      [
        'auditoria_licencias',
        'licencias',
        'licencias_v3',
        'operaciones_idempotentes',
        'usuarios',
      ].sort(),
    );
  });

  it('does not read protected collections at all', async () => {
    const { servicio, collection } = crearServicio(BD);

    await servicio.exportAllToJson();

    expect(collection).not.toHaveBeenCalledWith('usuarios');
    expect(collection).not.toHaveBeenCalledWith('licencias_v3');
  });
});

describe('ImportExportService.importFromJson', () => {
  it.each([
    'usuarios',
    'Usuarios',
    'licencias_v3',
    'licencias',
    'auditoria_licencias',
    'auditoria_licencias_v3',
    'operaciones_idempotentes',
    'system.users',
  ])(
    'rejects with 400 a request targeting %s and inserts nothing',
    async (nombre) => {
      const { servicio, insertOne } = crearServicio({});

      const promesa = servicio.importFromJson({
        productos: [{ nombre: 'Arroz' }],
        [nombre]: [{ usuario: 'intruso' }],
      });

      await expect(promesa).rejects.toBeInstanceOf(BadRequestException);
      expect(insertOne).not.toHaveBeenCalled();
    },
  );

  it('accepts a backup that carries the __omitidas metadata key without inserting it', async () => {
    const { servicio, insertOne } = crearServicio({});

    const res = await servicio.importFromJson({
      productos: [{ nombre: 'Arroz' }],
      __omitidas: ['usuarios'],
    });

    expect(res).toEqual({ imported: 1, errors: [] });
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it('rejects documents with top-level keys starting with $ or containing a dot', async () => {
    const { servicio, insertOne } = crearServicio({});

    const res = await servicio.importFromJson({
      productos: [
        { nombre: 'ok' },
        { $set: { x: 1 } },
        { 'a.b': 1 },
        { nombre: 'ok2' },
      ],
    });

    expect(res.imported).toBe(2);
    expect(res.errors).toHaveLength(2);
    expect(insertOne).toHaveBeenCalledTimes(2);
    expect(insertOne).toHaveBeenCalledWith('productos', { nombre: 'ok' });
    expect(insertOne).toHaveBeenCalledWith('productos', { nombre: 'ok2' });
  });

  it('rejects non-object documents', async () => {
    const { servicio, insertOne } = crearServicio({});

    const res = await servicio.importFromJson({
      productos: [null, 'x', [1], { nombre: 'ok' }] as never,
    });

    expect(res.imported).toBe(1);
    expect(res.errors).toHaveLength(3);
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it('keeps the current result shape for a normal import', async () => {
    const { servicio } = crearServicio({});

    await expect(
      servicio.importFromJson({ productos: [{ a: 1 }, { a: 2 }], otra: [] }),
    ).resolves.toEqual({ imported: 2, errors: [] });
  });

  it('exposes the protected prefixes constant', () => {
    expect(COLECCIONES_PROTEGIDAS_PREFIJOS).toEqual(
      expect.arrayContaining([
        'usuarios',
        'licencias',
        'auditoria_licencias',
        'operaciones_idempotentes',
      ]),
    );
  });
});
