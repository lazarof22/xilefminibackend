import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ProveedorService } from './proveedor.service';
import { Proveedor } from './schema/proveedor.schema';

const ID = '507f1f77bcf86cd799439011';

const datos = {
  codigo: 'PRV-001',
  nombre: 'Distribuidora Caribe',
  cuentaBancaria: '9225 1234',
  direccion: 'Calle 23 #456',
  telefono: 53555000,
};

/** Cadena find().collation().sort().exec() / findOne().collation().select().lean().exec(). */
const cadena = (resultado: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['collation', 'sort', 'select', 'lean']) {
    c[m] = jest.fn(() => c);
  }
  c.exec = jest.fn().mockResolvedValue(resultado);
  return c;
};

describe('ProveedorService', () => {
  let service: ProveedorService;
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const modulo = await Test.createTestingModule({
      providers: [
        ProveedorService,
        { provide: getModelToken(Proveedor.name), useValue: model },
      ],
    }).compile();
    service = modulo.get(ProveedorService);
  });

  it('crea un proveedor cuando el código está libre', async () => {
    model.findOne.mockReturnValue(cadena(null));
    model.create.mockResolvedValue({ _id: ID, ...datos });

    await expect(service.create(datos)).resolves.toMatchObject({
      codigo: 'PRV-001',
    });
    expect(model.create).toHaveBeenCalledWith(datos);
  });

  it('rechaza un código repetido (sin distinguir mayúsculas)', async () => {
    model.findOne.mockReturnValue(cadena({ _id: ID }));

    await expect(
      service.create({ ...datos, codigo: 'prv-001' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('convierte el error 11000 de Mongo en conflicto (carrera entre dos altas)', async () => {
    model.findOne.mockReturnValue(cadena(null));
    model.create.mockRejectedValue({ code: 11000 });

    await expect(service.create(datos)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lista ordenado por código', async () => {
    const c = cadena([{ codigo: 'A' }]);
    model.find.mockReturnValue(c);

    await expect(service.findAll()).resolves.toEqual([{ codigo: 'A' }]);
    expect(c.sort).toHaveBeenCalledWith({ codigo: 1 });
  });

  it('findOne: id inválido o inexistente da 404', async () => {
    await expect(service.findOne('no-es-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.findOne(ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update: no deja tomar el código de otro proveedor', async () => {
    const doc = { _id: ID, codigo: 'PRV-001', set: jest.fn(), save: jest.fn() };
    model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });
    model.findOne.mockReturnValue(cadena({ _id: '507f1f77bcf86cd799439099' }));

    await expect(
      service.update(ID, { codigo: 'PRV-002' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('update: guarda los cambios', async () => {
    const doc = {
      _id: ID,
      codigo: 'PRV-001',
      set: jest.fn(),
      save: jest.fn().mockResolvedValue({ _id: ID, nombre: 'Nuevo' }),
    };
    model.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

    await expect(
      service.update(ID, { nombre: 'Nuevo' }),
    ).resolves.toMatchObject({
      nombre: 'Nuevo',
    });
    expect(doc.set).toHaveBeenCalledWith({ nombre: 'Nuevo' });
  });

  it('remove: elimina o da 404', async () => {
    model.findByIdAndDelete.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: ID }),
    });
    await expect(service.remove(ID)).resolves.toEqual({ deleted: true });

    model.findByIdAndDelete.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(service.remove(ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
