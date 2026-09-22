import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { FacturaService } from './factura.service';
import { Factura } from './schema/factura.schema';
import { FacturaContador } from './schema/factura-contador.schema';
import {
  Cliente,
  ClienteDocument,
} from '../clientes y provedores/cliente/schemas/cliente.schema';
import { EmpresaDatosService } from '../configuracion/empresa-datos/empresa-datos.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { FACTURA_CONTADOR_ID } from './factura.constants';

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
  let savedFactura: Partial<Factura> & { save: jest.Mock };

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
    savedFactura = { save: jest.fn() };
    savedFactura.save.mockImplementation(() =>
      Promise.resolve(savedFactura as unknown as Factura),
    );

    facturaModelMock = jest.fn().mockImplementation(function (
      this: FacturaConstructorData,
      data: FacturaConstructorData,
    ) {
      Object.assign(this, data, { save: savedFactura.save });
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

    clienteModelMock = jest.fn() as unknown as ClienteModelMock;
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

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.numero).toBe(7);
      expect(construidoCon.id).toBe('FAC-000007');
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
