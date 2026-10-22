import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { CategoriaService } from './categoria.service';
import { Categoria } from './schema/categoria.schema';

describe('CategoriaService.create', () => {
  let service: CategoriaService;
  let findOne: jest.Mock;
  let guardados: { nombre_categoria: string }[];

  beforeEach(async () => {
    guardados = [];
    findOne = jest.fn().mockResolvedValue(null);
    const model = Object.assign(
      jest.fn().mockImplementation((doc: { nombre_categoria: string }) => ({
        save: () => {
          guardados.push(doc);
          return Promise.resolve(doc);
        },
      })),
      { findOne },
    );
    const mod = await Test.createTestingModule({
      providers: [
        CategoriaService,
        { provide: getModelToken(Categoria.name), useValue: model },
      ],
    }).compile();
    service = mod.get(CategoriaService);
  });

  it('guarda el nombre normalizado', async () => {
    await service.create({ nombre_categoria: '  bebidas   frías ' });
    expect(guardados).toEqual([{ nombre_categoria: 'Bebidas Frías' }]);
  });

  it('busca duplicados sin distinguir mayúsculas', async () => {
    await service.create({ nombre_categoria: 'bebidas' });
    const filtro = (
      findOne.mock.calls[0] as [{ nombre_categoria: { $regex: RegExp } }]
    )[0];
    expect(filtro.nombre_categoria.$regex.test('BEBIDAS')).toBe(true);
    expect(filtro.nombre_categoria.$regex.test('Bebidas ricas')).toBe(false);
  });

  it('rechaza una categoría que ya existe', async () => {
    findOne.mockResolvedValue({ nombre_categoria: 'Bebidas' });
    await expect(
      service.create({ nombre_categoria: 'BEBIDAS' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(guardados).toHaveLength(0);
  });

  it('rechaza un nombre en blanco', async () => {
    await expect(
      service.create({ nombre_categoria: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
