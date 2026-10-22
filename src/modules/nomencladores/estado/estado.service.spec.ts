import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { EstadoService } from './estado.service';
import { Estado } from './schema/estado.schema';

describe('EstadoService.create', () => {
  let service: EstadoService;
  let findOne: jest.Mock;
  let guardados: { estado: string }[];

  beforeEach(async () => {
    guardados = [];
    findOne = jest.fn().mockResolvedValue(null);
    const model = Object.assign(
      jest.fn().mockImplementation((doc: { estado: string }) => ({
        save: () => {
          guardados.push(doc);
          return Promise.resolve(doc);
        },
      })),
      { findOne },
    );
    const mod = await Test.createTestingModule({
      providers: [
        EstadoService,
        { provide: getModelToken(Estado.name), useValue: model },
      ],
    }).compile();
    service = mod.get(EstadoService);
  });

  it('guarda el nombre normalizado', async () => {
    await service.create({ estado: '  fuera de   servicio ' });
    expect(guardados).toEqual([{ estado: 'Fuera De Servicio' }]);
  });

  it('busca duplicados sin distinguir mayúsculas', async () => {
    await service.create({ estado: 'activo' });
    const filtro = (
      findOne.mock.calls[0] as [{ estado: { $regex: RegExp } }]
    )[0];
    expect(filtro.estado.$regex.test('ACTIVO')).toBe(true);
    expect(filtro.estado.$regex.test('Activo ahora')).toBe(false);
  });

  it('rechaza una estado que ya existe', async () => {
    findOne.mockResolvedValue({ estado: 'Activo' });
    await expect(service.create({ estado: 'ACTIVO' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(guardados).toHaveLength(0);
  });

  it('rechaza un nombre en blanco', async () => {
    await expect(service.create({ estado: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
