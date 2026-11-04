import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
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
    updateMany: jest.fn(
      (filtro: { activa: boolean; _id?: { $ne: Types.ObjectId } }) => {
        for (const d of docs) {
          const excluido = filtro._id && d._id.equals(filtro._id.$ne);
          if (d.activa === filtro.activa && !excluido) d.activa = false;
        }
        return { exec: () => Promise.resolve({}) };
      },
    ),
    findOne: jest.fn(),
    find: jest.fn(() => consulta(() => ordenar(docs))),
  };
  modelo.findOne.mockImplementation((filtro: { activa: boolean }) => {
    const q = {
      sort: () => q,
      lean: () => q,
      exec: () =>
        Promise.resolve(
          ordenar(docs.filter((d) => d.activa === filtro.activa))[0] ?? null,
        ),
    };
    return q;
  });
  return { modelo, docs };
}

describe('ConfiguracionTributariaService', () => {
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
