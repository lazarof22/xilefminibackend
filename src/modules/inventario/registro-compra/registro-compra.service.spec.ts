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
  let kardexModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    deleteOne?: jest.Mock;
  };

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
    kardexModel = {
      create: jest.fn().mockResolvedValue({}),
      // Sin movimientos previos con costo promedio.
      findOne: jest.fn().mockReturnValue(consulta(null)),
    };

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
        // Submayor SC-2-13: primera compra, el promedio es su propio costo.
        costoPromedio: 3.5,
        importeCUP: 42,
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

  describe('registrarLinea (recepción SC-2-04)', () => {
    const kardexId = new Types.ObjectId();

    beforeEach(() => {
      kardexModel.create.mockResolvedValue({ _id: kardexId });
    });

    it('escribe el kardex COMPRA con la referencia del documento y el costo, y devuelve su id', async () => {
      const res = await service.registrarLinea(dto, {
        referencia: 'REC-000007',
        motivo: 'Recepción REC-000007',
        importeCUP: 42,
        costoPromedio: 3.5,
        ubicacionFisica: 'Central / Estante 1',
      });

      expect(kardexModel.create).toHaveBeenCalledWith({
        fecha: new Date('2026-10-05T12:00:00.000Z'),
        productoId,
        tipo: KardexTipo.COMPRA,
        cantidad: 12,
        stock: 12,
        motivo: 'Recepción REC-000007',
        referencia: 'REC-000007',
        importeCUP: 42,
        costoPromedio: 3.5,
        ubicacionFisica: 'Central / Estante 1',
      });
      expect(res.registro).toEqual({ _id: registroId });
      expect(res.kardexId).toBe(kardexId.toString());
    });

    it('sin contexto escribe exactamente el mismo kardex que create (compatibilidad, con el Submayor)', async () => {
      await service.registrarLinea(dto);

      expect(kardexModel.create).toHaveBeenCalledWith({
        fecha: new Date('2026-10-05T12:00:00.000Z'),
        productoId,
        tipo: KardexTipo.COMPRA,
        cantidad: 12,
        stock: 12,
        motivo: 'Compra',
        referencia: registroId.toString(),
        costoPromedio: 3.5,
        importeCUP: 42,
      });
    });

    it('create sigue devolviendo solo el registro de compra', async () => {
      await expect(service.create(dto)).resolves.toEqual({ _id: registroId });
    });

    it('descartarLinea elimina la compra y su kardex por id', async () => {
      kardexModel.deleteOne = jest.fn().mockResolvedValue({});

      await service.descartarLinea({
        registroId: registroId.toString(),
        kardexId: kardexId.toString(),
      });

      expect(kardexModel.deleteOne).toHaveBeenCalledWith({
        _id: kardexId.toString(),
      });
      expect(registroModel.deleteOne).toHaveBeenCalledWith({
        _id: registroId.toString(),
      });
    });
  });

  describe('Submayor SC-2-13: costo promedio y ubicación física', () => {
    /** El kardex que se escribió en la última compra. */
    const escrito = (): Record<string, unknown> =>
      kardexModel.create.mock.calls[0][0] as Record<string, unknown>;

    it('promedio ponderado: 10 u a 5,00 en stock + 10 u a 8,00 que entran → 6,50; importe = 10 × 8,00', async () => {
      // La entrada ya está en el stock del producto (20 = 10 previas + 10).
      productoModel.findById.mockReturnValue(
        consulta({ _id: productoId, stock_inicial: 20 }),
      );
      kardexModel.findOne.mockReturnValue(consulta({ costoPromedio: 5 }));

      await service.create({ ...dto, cantidad: 10, costo_unitario: 8 });

      expect(escrito()).toMatchObject({
        costoPromedio: 6.5,
        importeCUP: 80,
        stock: 20,
      });
    });

    it('busca el último promedio por producto, del movimiento más reciente', async () => {
      const q = consulta({ costoPromedio: 5 });
      kardexModel.findOne.mockReturnValue(q);

      await service.create(dto);

      const [filtro] = kardexModel.findOne.mock.calls[0] as [
        { productoId: { $in: unknown[] }; costoPromedio: unknown },
      ];
      expect(filtro.productoId.$in).toEqual([productoId, productoId.toHexString()]);
      expect(filtro.costoPromedio).toMatchObject({ $exists: true });
      expect(q.sort).toHaveBeenCalledWith({ _id: -1 });
    });

    it('sin promedio en el kardex usa Producto.precio_compra como promedio anterior', async () => {
      productoModel.findById.mockReturnValue(
        consulta({ _id: productoId, stock_inicial: 20, precio_compra: 4 }),
      );

      await service.create({ ...dto, cantidad: 10, costo_unitario: 8 });

      // (10 × 4 + 10 × 8) / 20
      expect(escrito().costoPromedio).toBe(6);
    });

    it('sin kardex ni precio_compra el promedio anterior es el costo de la entrada', async () => {
      productoModel.findById.mockReturnValue(
        consulta({ _id: productoId, stock_inicial: 20 }),
      );

      await service.create({ ...dto, cantidad: 10, costo_unitario: 8 });

      expect(escrito().costoPromedio).toBe(8);
    });

    it('el stock previo que informa quien llama (suma de Existencia) tiene prioridad', async () => {
      kardexModel.findOne.mockReturnValue(consulta({ costoPromedio: 5 }));

      await service.registrarLinea(
        { ...dto, cantidad: 10, costo_unitario: 8 },
        { stockAnterior: 10 },
      );

      expect(escrito().costoPromedio).toBe(6.5);
    });

    it('el stock previo nunca es negativo si el producto aún no refleja la entrada', async () => {
      productoModel.findById.mockReturnValue(
        consulta({ _id: productoId, stock_inicial: 3 }),
      );
      kardexModel.findOne.mockReturnValue(consulta({ costoPromedio: 5 }));

      await service.create({ ...dto, cantidad: 10, costo_unitario: 8 });

      expect(escrito().costoPromedio).toBe(8);
    });

    it('arma la ubicación física con almacén, contenedor, sección, estante y casilla', async () => {
      almacenModel.findById.mockReturnValue(
        consulta({ _id: almacenId, nombreAlmacen: 'Central' }),
      );
      contenedorModel.findById.mockReturnValue(
        consulta({
          _id: contenedorId,
          almacen: almacenId,
          nombreContenedor: 'Estante Norte',
          seccion: 'B',
          estante: '3',
          casilla: '12',
        }),
      );

      await service.create(dto);

      expect(escrito().ubicacionFisica).toBe(
        'Central / Estante Norte / sección B · estante 3 · casilla 12',
      );
    });

    it('lo que informa el contexto (importe, promedio, ubicación) tiene prioridad', async () => {
      await service.registrarLinea(dto, {
        importeCUP: 40,
        costoPromedio: 9,
        ubicacionFisica: 'Otra',
      });

      expect(escrito()).toMatchObject({
        importeCUP: 40,
        costoPromedio: 9,
        ubicacionFisica: 'Otra',
      });
    });

    it('no inventa importeDivisa ni referenciaContable', async () => {
      await service.create(dto);

      expect(escrito()).not.toHaveProperty('importeDivisa');
      expect(escrito()).not.toHaveProperty('referenciaContable');
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
