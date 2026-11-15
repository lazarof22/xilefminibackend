import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ConfiguracionTributariaService } from './configuracion-tributaria.service';
import { ConfiguracionTributaria } from './schemas/configuracion-tributaria.schema';

interface Doc {
  _id: Types.ObjectId;
  impuestoVentasPct: number;
  vigenteDesde: Date;
  activa: boolean;
  bonificaciones: {
    programa: string;
    sector?: string;
    impuestoVentasPct: number;
    activa: boolean;
  }[];
}

type Filtro = {
  activa?: boolean;
  _id?: { $ne: Types.ObjectId };
  vigenteDesde?: { $gte?: Date; $lte?: Date };
};

/** Evaluates the subset of Mongo filters the service uses. */
function coincide(d: Doc, f: Filtro): boolean {
  if (f.activa !== undefined && d.activa !== f.activa) return false;
  if (f._id && d._id.equals(f._id.$ne)) return false;
  if (f.vigenteDesde?.$gte && !(d.vigenteDesde >= f.vigenteDesde.$gte))
    return false;
  if (f.vigenteDesde?.$lte && !(d.vigenteDesde <= f.vigenteDesde.$lte))
    return false;
  return true;
}

/** Modelo en memoria con la superficie de Mongoose que usa el servicio. */
function modeloEnMemoria(inicial: Doc[] = []) {
  const docs: Doc[] = [...inicial];
  const ordenar = (lista: Doc[]) =>
    [...lista].sort(
      (a, b) => b.vigenteDesde.getTime() - a.vigenteDesde.getTime(),
    );
  const consulta = (lista: () => Doc[]) => {
    const q = {
      sort: () => q,
      lean: () => q,
      exec: () => Promise.resolve(lista()),
    };
    return q;
  };
  const modelo = {
    create: jest.fn((datos: Omit<Doc, '_id'>) => {
      const doc: Doc = { _id: new Types.ObjectId(), ...datos };
      docs.push(doc);
      return Promise.resolve(doc);
    }),
    updateMany: jest.fn((filtro: Filtro) => {
      for (const d of docs) if (coincide(d, filtro)) d.activa = false;
      return { exec: () => Promise.resolve({}) };
    }),
    findOne: jest.fn(),
    find: jest.fn(() => consulta(() => ordenar(docs))),
  };
  modelo.findOne.mockImplementation((filtro: Filtro) => {
    const q = {
      sort: () => q,
      lean: () => q,
      exec: () =>
        Promise.resolve(ordenar(docs.filter((d) => coincide(d, filtro)))[0] ?? null),
    };
    return q;
  });
  return { modelo, docs };
}

/** Fixed "now" for every test; only `Date` is faked. */
const AHORA = new Date('2026-11-15T12:00:00.000Z');

describe('ConfiguracionTributariaService', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: AHORA,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
  });

  afterEach(() => jest.useRealTimers());

  async function crear(inicial: Doc[] = []) {
    const { modelo, docs } = modeloEnMemoria(inicial);
    const mod = await Test.createTestingModule({
      providers: [
        ConfiguracionTributariaService,
        {
          provide: getModelToken(ConfiguracionTributaria.name),
          useValue: modelo,
        },
      ],
    }).compile();
    return { service: mod.get(ConfiguracionTributariaService), docs, modelo };
  }

  describe('obtenerActiva', () => {
    it('devuelve null cuando no hay configuración (no inventa un impuesto)', async () => {
      const { service } = await crear();
      await expect(service.obtenerActiva()).resolves.toBeNull();
    });

    it('devuelve la configuración activa', async () => {
      const { service, docs } = await crear([
        {
          _id: new Types.ObjectId(),
          impuestoVentasPct: 10,
          vigenteDesde: new Date('2026-01-01'),
          activa: true,
          bonificaciones: [],
        },
      ]);
      const activa = await service.obtenerActiva();
      expect(activa?.impuestoVentasPct).toBe(10);
      expect(docs).toHaveLength(1);
    });
  });

  describe('obtenerImpuestoVentas (lo que usa el cobro del punto de venta)', () => {
    const doc = (pct: number): Doc => ({
      _id: new Types.ObjectId(),
      impuestoVentasPct: pct,
      vigenteDesde: new Date('2026-01-01'),
      activa: true,
      bonificaciones: [],
    });

    it('sin configuración el impuesto es 0 %', async () => {
      const { service } = await crear();
      await expect(service.obtenerImpuestoVentas()).resolves.toBe(0);
    });

    it('devuelve el impuesto de la configuración vigente', async () => {
      const { service } = await crear([doc(10)]);
      await expect(service.obtenerImpuestoVentas()).resolves.toBe(10);
    });

    it('un valor fuera de 0-100 en la base detiene la venta en vez de corregirse en silencio', async () => {
      const { service } = await crear([doc(150)]);
      await expect(service.obtenerImpuestoVentas()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('guardar', () => {
    it('crea la primera configuración como activa', async () => {
      const { service, docs } = await crear();
      const r = await service.guardar({
        impuestoVentasPct: 10,
        vigenteDesde: '2026-11-01',
      });
      expect(r.activa).toBe(true);
      expect(r.vigenteDesde).toEqual(new Date('2026-11-01'));
      expect(docs).toHaveLength(1);
    });

    it('un nuevo PUT crea otro documento y desactiva el anterior (historial auditable)', async () => {
      const previo: Doc = {
        _id: new Types.ObjectId(),
        impuestoVentasPct: 10,
        vigenteDesde: new Date('2026-01-01'),
        activa: true,
        bonificaciones: [],
      };
      const { service, docs } = await crear([previo]);

      const nueva = await service.guardar({
        impuestoVentasPct: 12,
        vigenteDesde: '2026-11-01',
      });

      expect(docs).toHaveLength(2);
      expect(docs.find((d) => d._id.equals(previo._id))?.activa).toBe(false);
      expect(docs.find((d) => d._id.equals(nueva._id))?.activa).toBe(true);
      expect(docs.find((d) => d._id.equals(previo._id))?.impuestoVentasPct).toBe(
        10,
      );
    });

    it('guarda las bonificaciones por programa/sector', async () => {
      const { service } = await crear();
      const r = await service.guardar({
        impuestoVentasPct: 10,
        vigenteDesde: '2026-11-01',
        bonificaciones: [
          { programa: 'MIPYME', sector: 'Agro', impuestoVentasPct: 5 },
        ],
      });
      expect(r.bonificaciones).toEqual([
        {
          programa: 'MIPYME',
          sector: 'Agro',
          impuestoVentasPct: 5,
          activa: true,
        },
      ]);
    });

    it('rechaza un porcentaje fuera de 0-100 y no persiste nada', async () => {
      const { service, docs } = await crear();
      await expect(
        service.guardar({ impuestoVentasPct: 101, vigenteDesde: '2026-11-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.guardar({
          impuestoVentasPct: 10,
          vigenteDesde: '2026-11-01',
          bonificaciones: [{ programa: 'X', impuestoVentasPct: -1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(docs).toHaveLength(0);
    });

    it('rechaza una fecha de vigencia inválida', async () => {
      const { service } = await crear();
      await expect(
        service.guardar({ impuestoVentasPct: 10, vigenteDesde: 'no-es-fecha' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin vigenteDesde usa la fecha actual', async () => {
      const { service } = await crear();
      const antes = Date.now();
      const r = await service.guardar({ impuestoVentasPct: 10 });
      expect(r.vigenteDesde.getTime()).toBeGreaterThanOrEqual(antes);
    });
  });

  describe('vigenteDesde (§6.7): una configuración futura no se aplica antes de su fecha', () => {
    const doc = (
      pct: number,
      vigenteDesde: string,
      activa = true,
    ): Doc => ({
      _id: new Types.ObjectId(),
      impuestoVentasPct: pct,
      vigenteDesde: new Date(vigenteDesde),
      activa,
      bonificaciones: [],
    });

    it('obtenerActiva ignora una configuración con vigenteDesde futura', async () => {
      const { service } = await crear([doc(10, '2026-12-01')]);
      await expect(service.obtenerActiva()).resolves.toBeNull();
      await expect(service.obtenerImpuestoVentas()).resolves.toBe(0);
    });

    it('con una vigente y otra futura aplica la vigente', async () => {
      const { service } = await crear([
        doc(10, '2026-01-01'),
        doc(12, '2026-12-01'),
      ]);
      const activa = await service.obtenerActiva();
      expect(activa?.impuestoVentasPct).toBe(10);
      await expect(service.obtenerImpuestoVentas()).resolves.toBe(10);
    });

    it('la futura pasa a aplicarse cuando llega su fecha', async () => {
      const { service } = await crear([
        doc(10, '2026-01-01'),
        doc(12, '2026-12-01'),
      ]);
      expect((await service.obtenerActiva())?.impuestoVentasPct).toBe(10);

      jest.setSystemTime(new Date('2026-11-30T23:59:59.999Z'));
      expect((await service.obtenerActiva())?.impuestoVentasPct).toBe(10);

      jest.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
      expect((await service.obtenerActiva())?.impuestoVentasPct).toBe(12);
      await expect(service.obtenerImpuestoVentas()).resolves.toBe(12);
    });

    it('guardar con fecha futura NO desactiva la vigente y ambas quedan seleccionables por fecha', async () => {
      const vigente = doc(10, '2026-01-01');
      const { service, docs } = await crear([vigente]);

      const futura = await service.guardar({
        impuestoVentasPct: 12,
        vigenteDesde: '2026-12-01',
      });

      expect(docs.find((d) => d._id.equals(vigente._id))?.activa).toBe(true);
      expect(docs.find((d) => d._id.equals(futura._id))?.activa).toBe(true);
      expect((await service.obtenerActiva())?.impuestoVentasPct).toBe(10);

      jest.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
      expect((await service.obtenerActiva())?.impuestoVentasPct).toBe(12);
    });

    it('guardar con fecha futura reemplaza otra pendiente de la misma fecha o posterior, pero no una pendiente anterior', async () => {
      const pendienteAnterior = doc(11, '2026-11-20');
      const pendienteIgual = doc(12, '2026-12-01');
      const pendientePosterior = doc(13, '2027-01-01');
      const { service, docs } = await crear([
        doc(10, '2026-01-01'),
        pendienteAnterior,
        pendienteIgual,
        pendientePosterior,
      ]);

      const nueva = await service.guardar({
        impuestoVentasPct: 14,
        vigenteDesde: '2026-12-01',
      });

      const activa = (d: Doc) => docs.find((x) => x._id.equals(d._id))?.activa;
      expect(activa(pendienteAnterior)).toBe(true);
      expect(activa(pendienteIgual)).toBe(false);
      expect(activa(pendientePosterior)).toBe(false);
      expect(activa(nueva as unknown as Doc)).toBe(true);
    });

    it('guardar con fecha vigente desactiva las ya vigentes pero conserva las pendientes', async () => {
      const previa = doc(10, '2026-01-01');
      const pendiente = doc(13, '2027-01-01');
      const { service, docs } = await crear([previa, pendiente]);

      const nueva = await service.guardar({
        impuestoVentasPct: 11,
        vigenteDesde: '2026-11-01',
      });

      const activa = (d: Doc) => docs.find((x) => x._id.equals(d._id))?.activa;
      expect(activa(previa)).toBe(false);
      expect(activa(pendiente)).toBe(true);
      expect(activa(nueva as unknown as Doc)).toBe(true);
      expect((await service.obtenerActiva())?.impuestoVentasPct).toBe(11);
    });

    it('historial sigue listando todas, también las futuras y las desactivadas', async () => {
      const { service } = await crear([
        doc(10, '2026-01-01', false),
        doc(12, '2026-12-01'),
        doc(11, '2026-06-01'),
      ]);
      const h = await service.historial();
      expect(h.map((d) => d.impuestoVentasPct)).toEqual([12, 11, 10]);
    });
  });

  describe('historial', () => {
    it('lista todas las configuraciones, la más reciente primero', async () => {
      const { service } = await crear([
        {
          _id: new Types.ObjectId(),
          impuestoVentasPct: 10,
          vigenteDesde: new Date('2026-01-01'),
          activa: false,
          bonificaciones: [],
        },
        {
          _id: new Types.ObjectId(),
          impuestoVentasPct: 12,
          vigenteDesde: new Date('2026-06-01'),
          activa: true,
          bonificaciones: [],
        },
      ]);
      const h = await service.historial();
      expect(h.map((d) => d.impuestoVentasPct)).toEqual([12, 10]);
    });
  });
});
