import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { FacturaService } from './factura.service';
import { Factura } from './schema/factura.schema';
import { FacturaContador } from './schema/factura-contador.schema';
import {
  Cliente,
  ClienteDocument,
} from '../clientes y provedores/cliente/schemas/cliente.schema';
import { EmpresaDatosService } from '../configuracion/empresa-datos/empresa-datos.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import {
  FACTURA_CONTADOR_ID,
  FACTURA_LISTADO_LIMITE_DEFECTO,
} from './factura.constants';

/**
 * Minimal chainable Mongoose query mock. Every method returns the same
 * mock instance so calls can be chained (`find().sort().exec()`), and
 * `exec` resolves to the configured result.
 */
interface QueryMock<T> {
  sort: jest.Mock<QueryMock<T>, unknown[]>;
  skip: jest.Mock<QueryMock<T>, unknown[]>;
  limit: jest.Mock<QueryMock<T>, unknown[]>;
  orFail: jest.Mock<QueryMock<T>, unknown[]>;
  exec: jest.Mock<Promise<T>, []>;
}

function crearQueryMock<T>(resultado: T): QueryMock<T> {
  const query = {} as QueryMock<T>;
  query.sort = jest.fn<QueryMock<T>, unknown[]>().mockReturnValue(query);
  query.skip = jest.fn<QueryMock<T>, unknown[]>().mockReturnValue(query);
  query.limit = jest.fn<QueryMock<T>, unknown[]>().mockReturnValue(query);
  query.orFail = jest.fn<QueryMock<T>, unknown[]>().mockReturnValue(query);
  query.exec = jest.fn<Promise<T>, []>().mockResolvedValue(resultado);
  return query;
}

/** Data passed to `new this.facturaModel(data)` inside `FacturaService.create`. */
type FacturaConstructorData = Record<string, unknown>;

// Mongoose models are constructor functions with static query methods. A
// plain object cannot satisfy `Model<T>`'s call signature, so the mock is
// built as a jest constructor mock and cast through `unknown`; this is the
// standard way to mock a Mongoose Model in Nest unit tests.
type FacturaModelMock = jest.Mock<unknown, [FacturaConstructorData]> & {
  find: jest.Mock<QueryMock<Factura | null>, unknown[]>;
  findOne: jest.Mock<QueryMock<Factura | null>, unknown[]>;
  findOneAndUpdate: jest.Mock<QueryMock<Factura | null>, unknown[]>;
};

type FacturaContadorModelMock = {
  findOneAndUpdate: jest.Mock<QueryMock<FacturaContador>, unknown[]>;
  updateOne: jest.Mock<QueryMock<unknown>, unknown[]>;
};

type ClienteModelMock = jest.Mock<unknown, [Record<string, unknown>]> & {
  findOne: jest.Mock<QueryMock<ClienteDocument | null>, unknown[]>;
};

/** Narrows an unknown record field, for the rare assertion that needs a nested shape. */
function comoRegistro(valor: unknown): Record<string, unknown> {
  return valor as Record<string, unknown>;
}

describe('FacturaService', () => {
  let service: FacturaService;
  let facturaModelMock: FacturaModelMock;
  let facturaContadorModelMock: FacturaContadorModelMock;
  let clienteModelMock: ClienteModelMock;
  let savedFactura: Partial<Factura> & {
    save: jest.Mock;
    validate: jest.Mock<Promise<void>, [unknown?]>;
  };
  let savedCliente: Record<string, unknown> & { save: jest.Mock };

  const empresaDatosServiceMock: Partial<
    Record<keyof EmpresaDatosService, jest.Mock>
  > = {
    obtener: jest.fn().mockResolvedValue(null),
  };

  const itemBase = {
    id: 'item-1',
    productoId: 'prod-1',
    productoNombre: 'Producto 1',
    cantidad: 2,
    precio: 100,
    costo: 50,
    descuentoPct: 0,
    descuentoMonto: 0,
    recargo: 0,
  };

  beforeEach(async () => {
    savedFactura = {
      save: jest.fn(),
      validate: jest.fn<Promise<void>, [unknown?]>(),
    };
    savedFactura.save.mockImplementation(() =>
      Promise.resolve(savedFactura as unknown as Factura),
    );
    savedFactura.validate.mockResolvedValue(undefined);

    facturaModelMock = jest.fn().mockImplementation(function (
      this: FacturaConstructorData,
      data: FacturaConstructorData,
    ) {
      Object.assign(this, data, {
        save: savedFactura.save,
        validate: savedFactura.validate,
      });
    }) as unknown as FacturaModelMock;
    facturaModelMock.find = jest.fn<QueryMock<Factura | null>, unknown[]>();
    facturaModelMock.findOne = jest.fn<QueryMock<Factura | null>, unknown[]>();
    facturaModelMock.findOneAndUpdate = jest.fn<
      QueryMock<Factura | null>,
      unknown[]
    >();

    facturaContadorModelMock = {
      findOneAndUpdate: jest.fn<QueryMock<FacturaContador>, unknown[]>(),
      updateOne: jest.fn<QueryMock<unknown>, unknown[]>(),
    };

    savedCliente = { save: jest.fn() };
    savedCliente.save.mockImplementation(() =>
      Promise.resolve(savedCliente as unknown as ClienteDocument),
    );

    clienteModelMock = jest.fn().mockImplementation(function (
      this: Record<string, unknown>,
      data: Record<string, unknown>,
    ) {
      Object.assign(this, data, { save: savedCliente.save });
    }) as unknown as ClienteModelMock;
    clienteModelMock.findOne = jest
      .fn<QueryMock<ClienteDocument | null>, unknown[]>()
      .mockReturnValue(crearQueryMock<ClienteDocument | null>(null));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacturaService,
        { provide: getModelToken(Factura.name), useValue: facturaModelMock },
        {
          provide: getModelToken(FacturaContador.name),
          useValue: facturaContadorModelMock,
        },
        { provide: getModelToken(Cliente.name), useValue: clienteModelMock },
        { provide: EmpresaDatosService, useValue: empresaDatosServiceMock },
      ],
    }).compile();

    service = module.get<FacturaService>(FacturaService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  function baseDto(): CreateFacturaDto {
    return {
      metodoPago: 'efectivo',
      items: [{ ...itemBase }],
    };
  }

  describe('numeracion atomica (T1)', () => {
    it('allocates the invoice number via an atomic $inc on the counter', async () => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 5 }),
      );

      await service.create(baseDto());

      expect(facturaContadorModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: FACTURA_CONTADOR_ID },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      );
    });

    it('builds the id from the allocated number, ignoring any client-sent id/numero', async () => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 7 }),
      );

      const dto = {
        ...baseDto(),
        id: 'FAC-999999',
        numero: 999,
      } as unknown as CreateFacturaDto;

      await service.create(dto);

      // numero/id are assigned directly on the constructed instance after
      // validation (T9), not passed to the constructor, so they are read
      // from the tracked instance rather than from the constructor args.
      const instancia = comoRegistro(facturaModelMock.mock.instances[0]);
      expect(instancia.numero).toBe(7);
      expect(instancia.id).toBe('FAC-000007');
    });
  });

  describe('server-side totals (T2)', () => {
    beforeEach(() => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );
    });

    it('ignores client-sent totals and recomputes them from the items', async () => {
      const dto = {
        ...baseDto(),
        items: [{ ...itemBase, cantidad: 2, precio: 100 }],
        subtotal: 999999,
        descuentoTotal: 999999,
        recargoTotal: 999999,
        total: 999999,
      } as unknown as CreateFacturaDto;

      await service.create(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.subtotal).toBe(200);
      expect(construidoCon.total).toBe(200);
    });

    it('always sets estado to confirmada for a new invoice, ignoring any client-sent estado', async () => {
      const dto = {
        ...baseDto(),
        estado: 'anulada',
      } as unknown as CreateFacturaDto;

      await service.create(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.estado).toBe('confirmada');
    });

    it('computes tax importe from porciento server-side', async () => {
      const dto = {
        ...baseDto(),
        items: [{ ...itemBase, cantidad: 1, precio: 100 }],
        impuesto: { tipo: 'ISV', porciento: 10, importe: 1 },
      } as unknown as CreateFacturaDto;

      await service.create(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(comoRegistro(construidoCon.impuesto).importe).toBe(10);
      expect(construidoCon.total).toBe(110);
    });
  });

  describe('emisor always from EmpresaDatos (T8)', () => {
    beforeEach(() => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );
    });

    it('uses obtenerEmisor (EmpresaDatos), ignoring any client-sent emisor', async () => {
      (empresaDatosServiceMock.obtener as jest.Mock).mockResolvedValueOnce({
        nombre: 'Empresa Real S.A.',
        ruc_nit: '111-REAL',
        direccion: 'Dir real',
        telefono: '000',
        email: 'real@empresa.com',
      });

      const dto = {
        ...baseDto(),
        emisor: { nombre: 'Empresa Falsa', nit: '999-FALSO' },
      } as unknown as CreateFacturaDto;

      await service.create(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(comoRegistro(construidoCon.emisor)).toEqual({
        nombre: 'Empresa Real S.A.',
        nit: '111-REAL',
        direccion: 'Dir real',
        telefono: '000',
        email: 'real@empresa.com',
      });
    });

    it('leaves emisor undefined when EmpresaDatos has no data configured', async () => {
      await service.create(baseDto());

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.emisor).toBeUndefined();
    });
  });

  describe('no burned invoice numbers (T9)', () => {
    it('validates the document, skipping numero/id, before allocating a number', async () => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );

      await service.create(baseDto());

      expect(savedFactura.validate).toHaveBeenCalledWith({
        pathsToSkip: ['numero', 'id'],
      });
      const ordenValidate = savedFactura.validate.mock.invocationCallOrder[0];
      const ordenAsignacion =
        facturaContadorModelMock.findOneAndUpdate.mock.invocationCallOrder[0];
      expect(ordenValidate).toBeLessThan(ordenAsignacion);
    });

    it('never allocates a number when document validation fails', async () => {
      savedFactura.validate.mockRejectedValueOnce(new Error('datos invalidos'));

      await expect(service.create(baseDto())).rejects.toThrow(
        'datos invalidos',
      );

      expect(facturaContadorModelMock.findOneAndUpdate).not.toHaveBeenCalled();
      expect(savedFactura.save).not.toHaveBeenCalled();
    });

    it('rolls back the counter when save fails and the rollback matches (number is released)', async () => {
      facturaContadorModelMock.findOneAndUpdate
        .mockReturnValueOnce(
          crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 5 }),
        )
        .mockReturnValueOnce(
          crearQueryMock<FacturaContador | null>({
            _id: FACTURA_CONTADOR_ID,
            seq: 4,
          }),
        );
      savedFactura.save.mockRejectedValueOnce(new Error('fallo al guardar'));
      const advertir = jest.spyOn(Logger.prototype, 'warn');

      await expect(service.create(baseDto())).rejects.toThrow(
        'fallo al guardar',
      );

      expect(facturaContadorModelMock.findOneAndUpdate).toHaveBeenNthCalledWith(
        2,
        { _id: FACTURA_CONTADOR_ID, seq: 5 },
        { $inc: { seq: -1 } },
      );
      expect(advertir).toHaveBeenCalledWith(expect.stringContaining('5'));
    });

    it('logs an error naming the burned numero when the rollback does not match', async () => {
      facturaContadorModelMock.findOneAndUpdate
        .mockReturnValueOnce(
          crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 5 }),
        )
        .mockReturnValueOnce(crearQueryMock<FacturaContador | null>(null));
      savedFactura.save.mockRejectedValueOnce(new Error('fallo al guardar'));
      const errorLog = jest.spyOn(Logger.prototype, 'error');

      await expect(service.create(baseDto())).rejects.toThrow(
        'fallo al guardar',
      );

      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('5'));
    });
  });

  describe('update / anular (T3)', () => {
    it('updates a non-annulled invoice with runValidators enabled', async () => {
      const actualizada = { id: 'FAC-000001', concepto: 'nuevo' } as Factura;
      facturaModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock<Factura | null>(actualizada),
      );

      const dto: UpdateFacturaDto = { concepto: 'nuevo' };
      const resultado = await service.update('FAC-000001', dto);

      expect(facturaModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { id: 'FAC-000001', estado: { $ne: 'anulada' } },
        dto,
        { new: true, runValidators: true },
      );
      expect(resultado).toBe(actualizada);
    });

    it('throws NotFoundException on update when the invoice does not exist', async () => {
      facturaModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );

      await expect(
        service.update('FAC-999999', { concepto: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException on update when the invoice is already anulada', async () => {
      facturaModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock<Factura | null>({
          id: 'FAC-000001',
          estado: 'anulada',
        } as Factura),
      );

      await expect(
        service.update('FAC-000001', { concepto: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('anular sets estado to anulada via a conditional update', async () => {
      const anulada = { id: 'FAC-000001', estado: 'anulada' } as Factura;
      facturaModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock<Factura | null>(anulada),
      );

      const resultado = await service.anular('FAC-000001');

      expect(facturaModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { id: 'FAC-000001', estado: { $ne: 'anulada' } },
        { estado: 'anulada' },
        { new: true, runValidators: true },
      );
      expect(resultado).toBe(anulada);
    });

    it('throws NotFoundException on anular when the invoice does not exist', async () => {
      facturaModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );

      await expect(service.anular('FAC-999999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ConflictException on anular when the invoice is already anulada', async () => {
      facturaModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock<Factura | null>({
          id: 'FAC-000001',
          estado: 'anulada',
        } as Factura),
      );

      await expect(service.anular('FAC-000001')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('default fecha in America/Havana (T4)', () => {
    beforeEach(() => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );
    });

    afterEach(() => jest.useRealTimers());

    it('defaults fecha to the local Havana date when not sent by the client', async () => {
      // 2026-09-23T02:00:00Z is 2026-09-22 local (Havana, UTC-4 in Sept).
      jest.useFakeTimers().setSystemTime(new Date('2026-09-23T02:00:00Z'));

      await service.create(baseDto());

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.fecha).toBe('2026-09-22');
    });

    it('uses the client-sent fecha as-is when provided', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-23T02:00:00Z'));

      const dto = { ...baseDto(), fecha: '2020-01-01' } as CreateFacturaDto;
      await service.create(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.fecha).toBe('2020-01-01');
    });
  });

  describe('client matching priority: nit > email > telefono (T5)', () => {
    beforeEach(() => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );
    });

    it('matches by nit first, without a single $or query', async () => {
      clienteModelMock.findOne.mockReturnValueOnce(
        crearQueryMock<ClienteDocument | null>({
          _id: 'cliente-1',
        } as unknown as ClienteDocument),
      );

      const dto = {
        ...baseDto(),
        nit: '111',
        email: 'a@b.com',
        telefono: '555',
      } as CreateFacturaDto;
      await service.create(dto);

      expect(clienteModelMock.findOne).toHaveBeenCalledTimes(1);
      expect(clienteModelMock.findOne).toHaveBeenCalledWith({ nit: '111' });
    });

    it('falls back to email when nit does not match', async () => {
      clienteModelMock.findOne
        .mockReturnValueOnce(crearQueryMock<ClienteDocument | null>(null))
        .mockReturnValueOnce(
          crearQueryMock<ClienteDocument | null>({
            _id: 'cliente-2',
          } as unknown as ClienteDocument),
        );

      const dto = {
        ...baseDto(),
        nit: '111',
        email: 'a@b.com',
        telefono: '555',
      } as CreateFacturaDto;
      await service.create(dto);

      expect(clienteModelMock.findOne).toHaveBeenCalledTimes(2);
      expect(clienteModelMock.findOne).toHaveBeenNthCalledWith(1, {
        nit: '111',
      });
      expect(clienteModelMock.findOne).toHaveBeenNthCalledWith(2, {
        email_cliente: 'a@b.com',
      });
    });

    it('falls back to telefono when nit and email do not match', async () => {
      clienteModelMock.findOne
        .mockReturnValueOnce(crearQueryMock<ClienteDocument | null>(null))
        .mockReturnValueOnce(crearQueryMock<ClienteDocument | null>(null))
        .mockReturnValueOnce(
          crearQueryMock<ClienteDocument | null>({
            _id: 'cliente-3',
          } as unknown as ClienteDocument),
        );

      const dto = {
        ...baseDto(),
        nit: '111',
        email: 'a@b.com',
        telefono: '555',
      } as CreateFacturaDto;
      await service.create(dto);

      expect(clienteModelMock.findOne).toHaveBeenCalledTimes(3);
      expect(clienteModelMock.findOne).toHaveBeenNthCalledWith(3, {
        telefono_cliente: '555',
      });
    });

    it('on a duplicate key error while creating, re-queries by the same priority and returns that client', async () => {
      // No match on the initial lookup, so the service tries to create one.
      clienteModelMock.findOne
        .mockReturnValueOnce(crearQueryMock<ClienteDocument | null>(null))
        .mockReturnValueOnce(
          crearQueryMock<ClienteDocument | null>({
            _id: 'cliente-recuperado',
          } as unknown as ClienteDocument),
        );
      savedCliente.save.mockRejectedValueOnce({ code: 11000 });

      const dto = { ...baseDto(), nit: '111' } as CreateFacturaDto;
      await service.create(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.clienteId).toBe('cliente-recuperado');
      expect(clienteModelMock.findOne).toHaveBeenCalledTimes(2);
    });

    it('logs a warning naming the matched keys (not their values) when a duplicate-key re-query finds nothing (T10)', async () => {
      // Every findOne call (initial lookup + post-duplicate re-query)
      // returns nothing, simulating the client having been removed
      // between the failed insert and the re-query.
      clienteModelMock.findOne.mockReturnValue(
        crearQueryMock<ClienteDocument | null>(null),
      );
      savedCliente.save.mockRejectedValueOnce({ code: 11000 });
      const advertir = jest.spyOn(Logger.prototype, 'warn');

      const dto = { ...baseDto(), nit: '111' } as CreateFacturaDto;
      const resultado = await service.create(dto);

      expect(resultado).toBeDefined();
      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.clienteId).toBeUndefined();
      expect(advertir).toHaveBeenCalledWith(expect.stringContaining('nit'));
      // No PII: the actual nit value must not leak into the log message.
      expect(advertir).not.toHaveBeenCalledWith(expect.stringContaining('111'));
    });

    it('logs and returns null (no clienteId, no throw) on a non-duplicate-key error', async () => {
      clienteModelMock.findOne.mockReturnValue(
        crearQueryMock<ClienteDocument | null>(null),
      );
      savedCliente.save.mockRejectedValueOnce(new Error('conexion perdida'));
      const advertir = jest.spyOn(Logger.prototype, 'warn');

      const dto = { ...baseDto(), nit: '111' } as CreateFacturaDto;
      const resultado = await service.create(dto);

      expect(resultado).toBeDefined();
      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.clienteId).toBeUndefined();
      expect(advertir).toHaveBeenCalled();
    });
  });

  describe('findAll bounded listing (T7)', () => {
    it('sorts by numero desc and applies the default page/limit when both are absent', async () => {
      const query = crearQueryMock<Factura[]>([]);
      facturaModelMock.find.mockReturnValue(query);

      await service.findAll({});

      expect(facturaModelMock.find).toHaveBeenCalledWith();
      expect(query.sort).toHaveBeenCalledWith({ numero: -1 });
      expect(query.skip).toHaveBeenCalledWith(0);
      expect(query.limit).toHaveBeenCalledWith(FACTURA_LISTADO_LIMITE_DEFECTO);
    });

    it('defaults to page 1 when only limit is provided', async () => {
      const query = crearQueryMock<Factura[]>([]);
      facturaModelMock.find.mockReturnValue(query);

      await service.findAll({ limit: 20 });

      expect(query.skip).toHaveBeenCalledWith(0);
      expect(query.limit).toHaveBeenCalledWith(20);
    });

    it('applies skip based on the requested page', async () => {
      const query = crearQueryMock<Factura[]>([]);
      facturaModelMock.find.mockReturnValue(query);

      await service.findAll({ page: 3, limit: 20 });

      expect(query.skip).toHaveBeenCalledWith(40);
      expect(query.limit).toHaveBeenCalledWith(20);
    });

    it('applies the default limit when only page is provided', async () => {
      const query = crearQueryMock<Factura[]>([]);
      facturaModelMock.find.mockReturnValue(query);

      await service.findAll({ page: 3 });

      expect(query.skip).toHaveBeenCalledWith(
        2 * FACTURA_LISTADO_LIMITE_DEFECTO,
      );
      expect(query.limit).toHaveBeenCalledWith(FACTURA_LISTADO_LIMITE_DEFECTO);
    });

    it('calling findAll with no argument at all still bounds the query (safety net if a caller bypasses the controller)', async () => {
      const query = crearQueryMock<Factura[]>([]);
      facturaModelMock.find.mockReturnValue(query);

      await service.findAll();

      expect(query.skip).toHaveBeenCalledWith(0);
      expect(query.limit).toHaveBeenCalledWith(FACTURA_LISTADO_LIMITE_DEFECTO);
    });
  });

  describe('seed on module init (T1)', () => {
    it('seeds the counter from the max existing numero using $max', async () => {
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock({ numero: 42 } as Factura),
      );
      facturaContadorModelMock.updateOne.mockReturnValue(
        crearQueryMock(undefined),
      );

      await service.onModuleInit();

      expect(facturaContadorModelMock.updateOne).toHaveBeenCalledWith(
        { _id: FACTURA_CONTADOR_ID },
        { $max: { seq: 42 } },
        { upsert: true },
      );
    });

    it('seeds with 0 when there are no existing invoices', async () => {
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock(null as unknown as Factura),
      );
      facturaContadorModelMock.updateOne.mockReturnValue(
        crearQueryMock(undefined),
      );

      await service.onModuleInit();

      expect(facturaContadorModelMock.updateOne).toHaveBeenCalledWith(
        { _id: FACTURA_CONTADOR_ID },
        { $max: { seq: 0 } },
        { upsert: true },
      );
    });
  });
});
