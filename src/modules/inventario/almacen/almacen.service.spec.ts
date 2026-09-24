import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException } from '@nestjs/common';
import { AlmacenService } from './almacen.service';
import { Almacen } from './schema/almacen.schema';
import { CreateAlmacenDto } from './dto/create-almacen.dto';
import { UpdateAlmacenDto } from './dto/update-almacen.dto';

/**
 * Minimal chainable Mongoose query mock, mirroring the one used in
 * `factura.service.spec.ts`.
 */
interface QueryMock<T> {
  exec: jest.Mock<Promise<T>, []>;
}

function crearQueryMockRechazado<T>(error: unknown): QueryMock<T> {
  return { exec: jest.fn<Promise<T>, []>().mockRejectedValue(error) };
}

type AlmacenConstructorData = Record<string, unknown>;

type AlmacenModelMock = jest.Mock<unknown, [AlmacenConstructorData]> & {
  // AlmacenService.create awaits `findOne(...)` directly (no `.exec()`),
  // unlike the rest of the module's query methods.
  findOne: jest.Mock<Promise<Almacen | null>, unknown[]>;
  findById: jest.Mock<QueryMock<Almacen | null>, unknown[]>;
  findByIdAndUpdate: jest.Mock<QueryMock<Almacen | null>, unknown[]>;
  findByIdAndDelete: jest.Mock<QueryMock<Almacen | null>, unknown[]>;
};

describe('AlmacenService', () => {
  let service: AlmacenService;
  let almacenModelMock: AlmacenModelMock;
  let savedAlmacen: Partial<Almacen> & { save: jest.Mock };

  beforeEach(async () => {
    savedAlmacen = { save: jest.fn() };
    savedAlmacen.save.mockImplementation(() =>
      Promise.resolve(savedAlmacen as unknown as Almacen),
    );

    almacenModelMock = jest.fn().mockImplementation(function (
      this: AlmacenConstructorData,
      data: AlmacenConstructorData,
    ) {
      Object.assign(this, data, { save: savedAlmacen.save });
    }) as unknown as AlmacenModelMock;
    almacenModelMock.findOne = jest
      .fn<Promise<Almacen | null>, unknown[]>()
      .mockResolvedValue(null);
    almacenModelMock.findById = jest.fn<QueryMock<Almacen | null>, unknown[]>();
    almacenModelMock.findByIdAndUpdate = jest.fn<
      QueryMock<Almacen | null>,
      unknown[]
    >();
    almacenModelMock.findByIdAndDelete = jest.fn<
      QueryMock<Almacen | null>,
      unknown[]
    >();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlmacenService,
        { provide: getModelToken(Almacen.name), useValue: almacenModelMock },
      ],
    }).compile();

    service = module.get<AlmacenService>(AlmacenService);
  });

  function dto(overrides: Partial<CreateAlmacenDto> = {}): CreateAlmacenDto {
    return {
      nombreAlmacen: 'Almacén Central',
      codigo: 'ALM-001',
      ...overrides,
    };
  }

  describe('create (T2)', () => {
    it('creates an almacén with a codigo', async () => {
      await service.create(dto());

      expect(almacenModelMock).toHaveBeenCalledWith(
        expect.objectContaining({ codigo: 'ALM-001' }),
      );
      expect(savedAlmacen.save).toHaveBeenCalled();
    });

    it('maps a duplicate codigo (E11000) to a 409 ConflictException', async () => {
      const duplicado = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      });
      savedAlmacen.save.mockRejectedValueOnce(duplicado);

      await expect(service.create(dto())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rethrows a non-duplicate-key error unchanged', async () => {
      savedAlmacen.save.mockRejectedValueOnce(new Error('conexion perdida'));

      await expect(service.create(dto())).rejects.toThrow('conexion perdida');
    });
  });

  describe('update (T2)', () => {
    it('maps a duplicate codigo (E11000) to a 409 ConflictException', async () => {
      const duplicado = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      });
      almacenModelMock.findByIdAndUpdate.mockReturnValue(
        crearQueryMockRechazado<Almacen | null>(duplicado),
      );

      const updateDto: UpdateAlmacenDto = { codigo: 'ALM-002' };
      await expect(
        service.update('almacen-1', updateDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows a non-duplicate-key error unchanged', async () => {
      almacenModelMock.findByIdAndUpdate.mockReturnValue(
        crearQueryMockRechazado<Almacen | null>(new Error('conexion perdida')),
      );

      await expect(
        service.update('almacen-1', { codigo: 'ALM-002' }),
      ).rejects.toThrow('conexion perdida');
    });
  });
});
