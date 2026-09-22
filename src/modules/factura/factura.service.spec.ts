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
  sort: jest.Mock<QueryMock<T>, [Record<string, number>]>;
  skip: jest.Mock<QueryMock<T>, [number]>;
  limit: jest.Mock<QueryMock<T>, [number]>;
  orFail: jest.Mock<QueryMock<T>, []>;
  exec: jest.Mock<Promise<T>, []>;
}

function crearQueryMock<T>(resultado: T): QueryMock<T> {
  const query = {} as QueryMock<T>;
  query.sort = jest.fn().mockReturnValue(query);
  query.skip = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  query.orFail = jest.fn().mockReturnValue(query);
  query.exec = jest.fn().mockResolvedValue(resultado);
  return query;
}

// Mongoose models are constructor functions with static query methods.
// A plain object cannot satisfy `Model<T>`'s call signature, so the mock
// is built as a jest constructor mock and cast through `unknown`; this is
// the standard way to mock a Mongoose Model in Nest unit tests.
type FacturaModelMock = jest.Mock & {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
};

type FacturaContadorModelMock = {
  findOneAndUpdate: jest.Mock;
  updateOne: jest.Mock;
};

type ClienteModelMock = jest.Mock & {
  findOne: jest.Mock;
};

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
      this: Record<string, unknown>,
      data: Partial<Factura>,
    ) {
      Object.assign(this, data, { save: savedFactura.save });
    }) as unknown as FacturaModelMock;
    facturaModelMock.find = jest.fn();
    facturaModelMock.findOne = jest.fn();
    facturaModelMock.findOneAndUpdate = jest.fn();

    facturaContadorModelMock = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
    };

    clienteModelMock = jest.fn() as unknown as ClienteModelMock;
    clienteModelMock.findOne = jest.fn().mockReturnValue(
      crearQueryMock<ClienteDocument | null>(null),
    );

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
    } as CreateFacturaDto;
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

      const construidoCon = facturaModelMock.mock.calls[0][0] as {
        id: string;
        numero: number;
      };
      expect(construidoCon.numero).toBe(7);
      expect(construidoCon.id).toBe('FAC-000007');
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
