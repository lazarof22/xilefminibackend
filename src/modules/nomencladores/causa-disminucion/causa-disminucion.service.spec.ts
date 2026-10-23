import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  CAUSAS_INICIALES,
  CausaDisminucionService,
} from './causa-disminucion.service';
import { CausaDisminucion } from './schema/causa-disminucion.schema';

const exec = <T>(valor: T) => ({ exec: () => Promise.resolve(valor) });

describe('CausaDisminucionService', () => {
  let service: CausaDisminucionService;
  let model: Record<string, jest.Mock>;
  let guardados: { nombre_causa: string }[];

  beforeEach(async () => {
    guardados = [];
    model = {
      findOne: jest.fn().mockResolvedValue(null),
      estimatedDocumentCount: jest.fn().mockResolvedValue(3),
      insertMany: jest.fn().mockResolvedValue([]),
      findById: jest.fn(() => exec(null)),
      findByIdAndUpdate: jest.fn(() => exec({ nombre_causa: 'x' })),
      findByIdAndDelete: jest.fn(() => exec({})),
      create: jest.fn(),
    };
    const ctor = Object.assign(
      jest.fn().mockImplementation((doc: { nombre_causa: string }) => ({
        save: () => {
          guardados.push(doc);
          return Promise.resolve(doc);
        },
      })),
      model,
    );
    const mod = await Test.createTestingModule({
      providers: [
        CausaDisminucionService,
        { provide: getModelToken(CausaDisminucion.name), useValue: ctor },
      ],
    }).compile();
    service = mod.get(CausaDisminucionService);
  });

  describe('onModuleInit', () => {
    it('carga las causas iniciales solo si el nomenclador está vacío', async () => {
      model.estimatedDocumentCount.mockResolvedValue(0);
      await service.onModuleInit();
      const docs = (
        model.insertMany.mock.calls[0] as [{ nombre_causa: string }[]]
      )[0];
      expect(docs.map((d) => d.nombre_causa)).toEqual(CAUSAS_INICIALES);
    });

    it('no toca nada si ya hay causas', async () => {
      await service.onModuleInit();
      expect(model.insertMany).not.toHaveBeenCalled();
    });

    it('si falla no impide arrancar', async () => {
      model.estimatedDocumentCount.mockRejectedValue(new Error('x'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('guarda el nombre normalizado', async () => {
      await service.create({ nombre_causa: '  producto   vencido ' });
      expect(guardados).toEqual([{ nombre_causa: 'Producto Vencido' }]);
    });

    it('detecta duplicados sin distinguir mayúsculas', async () => {
      await service.create({ nombre_causa: 'pérdida' });
      const filtro = (
        model.findOne.mock.calls[0] as [{ nombre_causa: { $regex: RegExp } }]
      )[0];
      expect(filtro.nombre_causa.$regex.test('PÉRDIDA')).toBe(true);
      expect(filtro.nombre_causa.$regex.test('Pérdida total')).toBe(false);
    });

    it('rechaza una causa que ya existe', async () => {
      model.findOne.mockResolvedValue({ nombre_causa: 'Pérdida' });
      await expect(
        service.create({ nombre_causa: 'PÉRDIDA' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(guardados).toHaveLength(0);
    });

    it('rechaza un nombre en blanco', async () => {
      await expect(
        service.create({ nombre_causa: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update / remove / findOne', () => {
    const id = new Types.ObjectId().toHexString();

    it('al renombrar excluye la propia causa de la búsqueda de duplicados', async () => {
      model.findById.mockReturnValue(exec({ nombre_causa: 'Vieja' }));
      await service.update(id, { nombre_causa: 'nueva' });
      const filtro = (
        model.findOne.mock.calls[0] as [{ _id: { $ne: string } }]
      )[0];
      expect(filtro._id).toEqual({ $ne: id });
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        id,
        { nombre_causa: 'Nueva' },
        { new: true },
      );
    });

    it('no permite renombrar a una causa que ya existe', async () => {
      model.findById.mockReturnValue(exec({ nombre_causa: 'Vieja' }));
      model.findOne.mockResolvedValue({ nombre_causa: 'Nueva' });
      await expect(
        service.update(id, { nombre_causa: 'Nueva' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 con id inválido o inexistente', async () => {
      await expect(service.findOne('no-es-un-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      model.findByIdAndDelete.mockReturnValue(exec(null));
      await expect(service.remove(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('findOrCreate reutiliza la causa existente', async () => {
    const _id = new Types.ObjectId();
    model.findOne.mockResolvedValue({ _id });
    expect(await service.findOrCreate('pérdida')).toBe(_id);
    expect(model.create).not.toHaveBeenCalled();
  });
});
