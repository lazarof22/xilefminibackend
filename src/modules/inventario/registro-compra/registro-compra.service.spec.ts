import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RegistroCompraService } from './registro-compra.service';
import { RegistroCompra } from './schema/registro-compra.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';

/** Consulta encadenable: select/populate/sort/lean devuelven la misma consulta. */
function consulta<T>(resultado: T) {
  const q: Record<string, jest.Mock> = {};
  ['select', 'populate', 'sort', 'lean'].forEach((m) => {
    q[m] = jest.fn().mockReturnValue(q);
  });
  q.exec = jest.fn().mockResolvedValue(resultado);
  return q;
}

describe('RegistroCompraService', () => {
  let service: RegistroCompraService;

  const productoId = new Types.ObjectId();
  const almacenId = new Types.ObjectId();
  const contenedorId = new Types.ObjectId();
  const registroId = new Types.ObjectId();

  const dto = {
    producto: productoId.toString(),
    almacen: almacenId.toString(),
    contenedor: contenedorId.toString(),
    cantidad: 12,
    costo_unitario: 3.5,
    fecha: '2026-10-05',
  };

  let registroModel: {
    create: jest.Mock;
    deleteOne: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
  };
  let productoModel: { findById: jest.Mock };
  let almacenModel: { findById: jest.Mock };
  let contenedorModel: { findById: jest.Mock };
  let kardexModel: { create: jest.Mock };

  beforeEach(async () => {
    registroModel = {
      create: jest.fn().mockResolvedValue({ _id: registroId }),
      deleteOne: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue(consulta([{ _id: registroId }])),
      findById: jest.fn().mockReturnValue(consulta({ _id: registroId })),
    };
    productoModel = {
      findById: jest
        .fn()
        .mockReturnValue(consulta({ _id: productoId, stock_inicial: 12 })),
    };
    almacenModel = {
      findById: jest.fn().mockReturnValue(consulta({ _id: almacenId })),
    };
    contenedorModel = {
      findById: jest
        .fn()
        .mockReturnValue(consulta({ _id: contenedorId, almacen: almacenId })),
    };
    kardexModel = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistroCompraService,
        { provide: getModelToken(RegistroCompra.name), useValue: registroModel },
        { provide: getModelToken(Producto.name), useValue: productoModel },
        { provide: getModelToken(Almacen.name), useValue: almacenModel },
        { provide: getModelToken(Contenedor.name), useValue: contenedorModel },
        { provide: getModelToken(Kardex.name), useValue: kardexModel },
      ],
    }).compile();

    service = module.get(RegistroCompraService);
  });

  describe('create', () => {
    it('guarda los datos del formulario y calcula el total en el servidor', async () => {
      const res = await service.create(dto);

      expect(registroModel.create).toHaveBeenCalledWith({
        producto: productoId,
        almacen: almacenId,
        contenedor: contenedorId,
        cantidad: 12,
        costo_unitario: 3.5,
        total: 42, // 12 × 3.5
        fecha: new Date('2026-10-05T12:00:00.000Z'),
      });
      expect(res).toEqual({ _id: registroId });
    });

    it('redondea el total a 2 decimales', async () => {
      await service.create({ ...dto, cantidad: 3, costo_unitario: 0.1 + 0.2 });

      const [guardado] = registroModel.create.mock.calls[0] as [{ total: number }];
      expect(guardado.total).toBe(0.9);
    });

    it('escribe un kardex de tipo COMPRA con motivo "Compra" y el stock actual', async () => {
      await service.create(dto);

      expect(kardexModel.create).toHaveBeenCalledTimes(1);
      expect(kardexModel.create).toHaveBeenCalledWith({
        fecha: new Date('2026-10-05T12:00:00.000Z'),
        productoId,
        tipo: KardexTipo.COMPRA,
        cantidad: 12,
        stock: 12,
        motivo: 'Compra',
        referencia: registroId.toString(),
      });
    });

    it('no modifica el stock del producto (ya lo fijó POST /producto)', async () => {
      await service.create(dto);

      expect(productoModel.findById).toHaveBeenCalledTimes(1);
      // Solo se consulta: el modelo de producto no expone ninguna escritura.
      expect(Object.keys(productoModel)).toEqual(['findById']);
    });

    it('usa la fecha actual si no se envía una', async () => {
      const antes = Date.now();
      await service.create({ ...dto, fecha: undefined });

      const [guardado] = registroModel.create.mock.calls[0] as [{ fecha: Date }];
      expect(guardado.fecha.getTime()).toBeGreaterThanOrEqual(antes);
    });

    it('acepta una fecha ISO completa tal cual', async () => {
      await service.create({ ...dto, fecha: '2026-10-05T03:00:00.000Z' });

      const [guardado] = registroModel.create.mock.calls[0] as [{ fecha: Date }];
      expect(guardado.fecha).toEqual(new Date('2026-10-05T03:00:00.000Z'));
    });

    it('si el stock del producto no es válido, el kardex usa 0', async () => {
      productoModel.findById.mockReturnValue(
        consulta({ _id: productoId, stock_inicial: undefined }),
      );

      await service.create(dto);

      expect(kardexModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ stock: 0 }),
      );
    });

    it('si falla el kardex, elimina la compra y propaga el error original', async () => {
      const fallo = new Error('kardex caído');
      kardexModel.create.mockRejectedValue(fallo);

      await expect(service.create(dto)).rejects.toBe(fallo);

      expect(registroModel.deleteOne).toHaveBeenCalledWith({ _id: registroId });
    });

    it('si además falla el borrado, igualmente propaga el error original', async () => {
      const fallo = new Error('kardex caído');
      kardexModel.create.mockRejectedValue(fallo);
      registroModel.deleteOne.mockRejectedValue(new Error('no se pudo borrar'));

      await expect(service.create(dto)).rejects.toBe(fallo);
    });

    it('lanza NotFound si el producto no existe y no guarda nada', async () => {
      productoModel.findById.mockReturnValue(consulta(null));

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
      expect(registroModel.create).not.toHaveBeenCalled();
      expect(kardexModel.create).not.toHaveBeenCalled();
    });

    it('lanza NotFound si el almacén no existe', async () => {
      almacenModel.findById.mockReturnValue(consulta(null));

      await expect(service.create(dto)).rejects.toThrow('El almacén no existe');
      expect(registroModel.create).not.toHaveBeenCalled();
    });

    it('lanza NotFound si el contenedor no existe', async () => {
      contenedorModel.findById.mockReturnValue(consulta(null));

      await expect(service.create(dto)).rejects.toThrow('El contenedor no existe');
      expect(registroModel.create).not.toHaveBeenCalled();
    });

    it('rechaza un contenedor que pertenece a otro almacén', async () => {
      contenedorModel.findById.mockReturnValue(
        consulta({ _id: contenedorId, almacen: new Types.ObjectId() }),
      );

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(registroModel.create).not.toHaveBeenCalled();
      expect(kardexModel.create).not.toHaveBeenCalled();
    });
  });

  describe('consultas', () => {
    it('findAll puebla producto, almacén y contenedor y ordena por fecha descendente', async () => {
      const q = consulta([{ _id: registroId }]);
      registroModel.find.mockReturnValue(q);

      const res = await service.findAll();

      const populados = q.populate.mock.calls.map(
        (c: [{ path: string }]) => c[0].path,
      );
      expect(populados).toEqual(['producto', 'almacen', 'contenedor']);
      expect(q.sort).toHaveBeenCalledWith({ fecha: -1, createdAt: -1 });
      expect(res).toEqual([{ _id: registroId }]);
    });

    it('findOne rechaza un ID inválido', async () => {
      await expect(service.findOne('no-es-un-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('findOne lanza NotFound si no existe', async () => {
      registroModel.findById.mockReturnValue(consulta(null));

      await expect(service.findOne(registroId.toString())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('findOne devuelve la compra', async () => {
      await expect(service.findOne(registroId.toString())).resolves.toEqual({
        _id: registroId,
      });
    });
  });
});
