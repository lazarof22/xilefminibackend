import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EmpresaDatosService } from './empresa-datos.service';
import { EmpresaDatos } from './schemas/empresa-datos.schema';
import { NomencladorHelper } from '../nomenclador-helper/nomenclador-helper.service';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CiudadService } from '../../nomencladores/ciudad/ciudad.service';

const mockNomencladorHelper = {
  isObjectId: jest.fn((v: any) => /^[0-9a-fA-F]{24}$/.test(v)),
  findOrCreatePais: jest.fn((name: string) => Promise.resolve(new Types.ObjectId('507f1f77bcf86cd799439011'))),
};

const PAIS_ID = '507f1f77bcf86cd799439011';
const CIUDAD_ID = '507f1f77bcf86cd799439022';

describe('EmpresaDatosService', () => {
  let service: EmpresaDatosService;
  let mockModel: any;
  let mockCiudadService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    mockModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    mockCiudadService = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmpresaDatosService,
        { provide: getModelToken(EmpresaDatos.name), useValue: mockModel },
        { provide: NomencladorHelper, useValue: mockNomencladorHelper },
        { provide: CiudadService, useValue: mockCiudadService },
      ],
    }).compile();

    service = module.get<EmpresaDatosService>(EmpresaDatosService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('obtener', () => {
    it('should return empresa data', async () => {
      const doc = { nombre: 'Test' };
      mockModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(doc),
      });
      const result = await service.obtener();
      expect(result).toEqual(doc);
    });

    it('should return null if no data', async () => {
      mockModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });
      const result = await service.obtener();
      expect(result).toBeNull();
    });
  });

  describe('guardar', () => {
    it('should create if not exists', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({ nombre: 'New' });
      const dto = { nombre: 'New Corp' };
      const result = await service.guardar(dto);
      expect(mockModel.create).toHaveBeenCalledWith(dto);
    });

    it('should update if exists', async () => {
      const save = jest.fn();
      save.mockResolvedValue({ nombre: 'Updated' });
      mockModel.findOne.mockResolvedValue({ nombre: 'Old', save });
      const dto = { nombre: 'Updated Corp' };
      await service.guardar(dto);
      expect(save).toHaveBeenCalled();
    });
  });

  describe('guardarLogo', () => {
    it('should update logo on existing record', async () => {
      const save = jest.fn();
      save.mockResolvedValue({ logo: 'base64' });
      const doc = { logo: '', save };
      mockModel.findOne.mockResolvedValue(doc);
      await service.guardarLogo('base64string');
      expect(doc.logo).toBe('base64string');
      expect(save).toHaveBeenCalled();
    });

    it('should create with logo if no record', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({ nombre: 'Sin nombre', logo: 'b64' });
      await service.guardarLogo('base64string');
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ logo: 'base64string' }),
      );
    });
  });

  describe('ciudad (referencia al nomenclador Ciudad)', () => {
    const consultaLean = (doc: unknown) => ({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(doc),
    });

    it('obtener: un documento antiguo con ciudad en texto sigue devolviendo una ciudad imprimible', async () => {
      mockModel.findOne.mockReturnValue(
        consultaLean({ nombre: 'Test', ciudad: 'Caracas' }),
      );
      const r = await service.obtener();
      expect(r?.ciudad).toBe('Caracas');
      expect(mockCiudadService.findOne).not.toHaveBeenCalled();
    });

    it('obtener: con referencia devuelve el nombre actual de la ciudad en `ciudad`', async () => {
      mockModel.findOne.mockReturnValue(
        consultaLean({ nombre: 'Test', ciudad: 'Vieja', ciudadId: CIUDAD_ID }),
      );
      mockCiudadService.findOne.mockResolvedValue({ nombreCiudad: 'La Habana' });
      const r = await service.obtener();
      expect(r?.ciudad).toBe('La Habana');
      expect(r?.ciudadId).toBe(CIUDAD_ID);
    });

    it('obtener: si la ciudad referenciada ya no existe conserva el texto guardado', async () => {
      mockModel.findOne.mockReturnValue(
        consultaLean({ nombre: 'Test', ciudad: 'Santiago', ciudadId: CIUDAD_ID }),
      );
      mockCiudadService.findOne.mockRejectedValue(new NotFoundException());
      const r = await service.obtener();
      expect(r?.ciudad).toBe('Santiago');
    });

    it('guardar con ciudadId guarda la referencia y el nombre imprimible', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({});
      mockCiudadService.findOne.mockResolvedValue({ nombreCiudad: 'La Habana' });
      await service.guardar({ nombre: 'X', ciudadId: CIUDAD_ID });
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ ciudadId: CIUDAD_ID, ciudad: 'La Habana' }),
      );
    });

    it('guardar con un ciudadId inexistente propaga el error y no persiste', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockCiudadService.findOne.mockRejectedValue(new NotFoundException());
      await expect(
        service.guardar({ nombre: 'X', ciudadId: CIUDAD_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockModel.create).not.toHaveBeenCalled();
    });

    it('guardar con texto legacy reutiliza la ciudad existente del país (sin duplicar)', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({});
      mockCiudadService.findAll.mockResolvedValue([
        { _id: new Types.ObjectId(CIUDAD_ID), nombreCiudad: 'La Habana' },
      ]);
      await service.guardar({ nombre: 'X', pais: PAIS_ID, ciudad: 'la habana' });
      expect(mockCiudadService.create).not.toHaveBeenCalled();
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ciudadId: new Types.ObjectId(CIUDAD_ID),
          ciudad: 'La Habana',
        }),
      );
    });

    it('guardar con texto legacy crea la ciudad si no existe en el país', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({});
      mockCiudadService.create.mockResolvedValue({
        _id: new Types.ObjectId(CIUDAD_ID),
        nombreCiudad: 'Holguín',
      });
      await service.guardar({ nombre: 'X', pais: PAIS_ID, ciudad: 'Holguín' });
      expect(mockCiudadService.create).toHaveBeenCalledWith({
        nombreCiudad: 'Holguín',
        pais: PAIS_ID,
      });
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ciudadId: new Types.ObjectId(CIUDAD_ID),
          ciudad: 'Holguín',
        }),
      );
    });

    it('guardar con texto y sin país conserva solo el texto (no inventa país)', async () => {
      mockModel.findOne.mockResolvedValue(null);
      mockModel.create.mockResolvedValue({});
      await service.guardar({ nombre: 'X', ciudad: 'Caracas' });
      expect(mockCiudadService.create).not.toHaveBeenCalled();
      const datos = mockModel.create.mock.calls[0][0];
      expect(datos.ciudad).toBe('Caracas');
      expect(datos.ciudadId).toBeUndefined();
    });

    it('guardar sin tocar la ciudad no la modifica', async () => {
      const save = jest.fn().mockResolvedValue({});
      const existente: Record<string, unknown> = {
        ciudad: 'Caracas',
        ciudadId: CIUDAD_ID,
        save,
      };
      mockModel.findOne.mockResolvedValue(existente);
      await service.guardar({ telefono: '123' });
      expect(existente.ciudad).toBe('Caracas');
      expect(existente.ciudadId).toBe(CIUDAD_ID);
      expect(mockCiudadService.findOne).not.toHaveBeenCalled();
    });
  });
});
