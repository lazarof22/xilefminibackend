import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { Usuario } from '../../auth/schemas/empleado.schema';
import { NomencladorHelper } from '../nomenclador-helper/nomenclador-helper.service';
import { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import {
  CupoUsuariosOps,
  LicenciaService,
} from '../../licencia/licencia.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

const mockNomencladorHelper = {
  isObjectId: jest.fn((v: any) => /^[0-9a-fA-F]{24}$/.test(v)),
  findOrCreateDepartamento: jest.fn((name: string) => Promise.resolve(new Types.ObjectId('507f1f77bcf86cd799439011'))),
  findOrCreateCargoEmpleado: jest.fn((name: string) => Promise.resolve(new Types.ObjectId('507f1f77bcf86cd799439012'))),
};

describe('UsuariosService', () => {
  let service: UsuariosService;
  let mockModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    findByIdAndDelete: jest.Mock;
    create: jest.Mock;
    countDocuments: jest.Mock;
    deleteOne: jest.Mock;
  };
  let mockLicenciaService: { crearUsuarioConCupo: jest.Mock };

  beforeEach(async () => {
    mockModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findByIdAndDelete: jest.fn(),
      create: jest.fn(),
      countDocuments: jest.fn(),
      deleteOne: jest.fn(),
    };
    mockModel.deleteOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({}),
    });
    mockModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(4),
    });
    mockLicenciaService = {
      crearUsuarioConCupo: jest.fn(
        (_empresa: string | undefined, ops: CupoUsuariosOps<unknown>) =>
          ops.crear(),
      ),
    };
    mockModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsuariosService,
        { provide: getModelToken(Usuario.name), useValue: mockModel },
        { provide: NomencladorHelper, useValue: mockNomencladorHelper },
        { provide: LicenciaService, useValue: mockLicenciaService },
      ],
    }).compile();

    service = module.get<UsuariosService>(UsuariosService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return users without password', async () => {
      const users = [{ nombre_empleado: 'Test', correo_empleado: 't@t.com' }];
      mockModel.find().exec.mockResolvedValue(users);
      const result = await service.findAll();
      expect(result).toEqual(users);
    });
  });

  describe('create', () => {
    const dto = {
      ci_empleado: '12345678901',
      nombre_empleado: 'Juan',
      correo_empleado: 'juan@test.com',
      contraseña: 'Test123!',
      departamento: '60d5f9f8e3b3c8b0f4e4d3a1' as any,
      cargo: '60d5f9f8e3b3c8b0f4e4d3a2' as any,
      salario: 2500,
    };

    it('should create a user with hashed password', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({
        toObject: () => ({ ...dto, _id: 'abc' }),
      });
      const result = await service.create(dto);
      expect(bcrypt.hash).toHaveBeenCalledWith('Test123!', 10);
      expect(result).toBeDefined();
    });

    it('creates the user through the install-wide license cap helper', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({
        _id: 'abc',
        toObject: () => ({ ...dto, _id: 'abc', contraseña: 'hash' }),
      });
      mockLicenciaService.crearUsuarioConCupo.mockImplementation(
        async (_empresa: string | undefined, ops: CupoUsuariosOps<unknown>) => {
          expect(await ops.contar()).toBe(4);
          const creado = await ops.crear();
          await ops.eliminar(creado);
          return creado;
        },
      );
      const result = (await service.create(dto)) as unknown as Record<
        string,
        unknown
      >;
      expect(mockLicenciaService.crearUsuarioConCupo).toHaveBeenCalledWith(
        undefined,
        expect.any(Object),
      );
      expect(mockModel.countDocuments).toHaveBeenCalledWith({});
      expect(mockModel.create).toHaveBeenCalled();
      expect(mockModel.deleteOne).toHaveBeenCalledWith({ _id: 'abc' });
      expect(result.contraseña).toBeUndefined();
    });

    it('rejects and does not save when the license user cap is reached', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockLicenciaService.crearUsuarioConCupo.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(service.create(dto)).rejects.toThrow(ForbiddenException);
      expect(mockModel.create).not.toHaveBeenCalled();
    });

    it('checks duplicates before the license cap', async () => {
      mockModel.findOne.mockResolvedValueOnce({
        correo_empleado: 'juan@test.com',
      });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockLicenciaService.crearUsuarioConCupo).not.toHaveBeenCalled();
    });

    it('should throw if email exists', async () => {
      mockModel.findOne.mockResolvedValueOnce({ correo_empleado: 'juan@test.com' });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('should throw if ci exists', async () => {
      mockModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ci_empleado: '12345678901' });
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('should delete user by id', async () => {
      mockModel.findByIdAndDelete.mockResolvedValue({ _id: 'abc' });
      await service.remove('abc');
      expect(mockModel.findByIdAndDelete).toHaveBeenCalledWith('abc');
    });

    it('should throw if user not found', async () => {
      mockModel.findByIdAndDelete.mockResolvedValue(null);
      await expect(service.remove('abc')).rejects.toThrow(NotFoundException);
    });
  });
});
