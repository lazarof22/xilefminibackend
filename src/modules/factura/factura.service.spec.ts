import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  ConflictException,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { FacturaService } from './factura.service';
import { Factura } from './schema/factura.schema';
import { FacturaContador } from './schema/factura-contador.schema';
import mongoose from 'mongoose';
import {
  Cliente,
  ClienteDocument,
  ClienteSchema,
} from '../clientes y provedores/cliente/schemas/cliente.schema';
import {
  Almacen,
  AlmacenDocument,
} from '../inventario/almacen/schema/almacen.schema';
import {
  Producto,
  ProductoDocument,
} from '../inventario/producto/schemas/producto.schema';
import { Pais, PaisDocument } from '../nomencladores/pais/schema/pais.schema';
import { Usuario, UsuarioDocument } from '../auth/schemas/empleado.schema';
import { EmpresaDatosService } from '../configuracion/empresa-datos/empresa-datos.service';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import {
  FACTURA_CLIENTE_DIRECCION_PLACEHOLDER,
  FACTURA_CONTADOR_ID,
  FACTURA_LISTADO_LIMITE_DEFECTO,
  FACTURA_TIMEZONE,
} from './factura.constants';
import { obtenerFechaEnZona } from './factura-fecha';

const ALMACEN_ID = '507f1f77bcf86cd799439011';
const PRODUCTO_ID = '507f1f77bcf86cd799439012';
const USER_ID = '507f1f77bcf86cd799439013';

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
  find: jest.Mock<QueryMock<Factura[]>, unknown[]>;
  findOne: jest.Mock<QueryMock<Factura | null>, unknown[]>;
  findOneAndUpdate: jest.Mock<QueryMock<Factura | null>, unknown[]>;
};

type FacturaContadorModelMock = {
  findOneAndUpdate: jest.Mock<QueryMock<FacturaContador | null>, unknown[]>;
  updateOne: jest.Mock<QueryMock<unknown>, unknown[]>;
};

type ClienteModelMock = jest.Mock<unknown, [Record<string, unknown>]> & {
  findOne: jest.Mock<QueryMock<ClienteDocument | null>, unknown[]>;
};

type AlmacenModelMock = {
  findById: jest.Mock<QueryMock<AlmacenDocument | null>, unknown[]>;
};

type ProductoModelMock = {
  find: jest.Mock<QueryMock<ProductoDocument[]>, unknown[]>;
};

type PaisModelMock = {
  findById: jest.Mock<QueryMock<PaisDocument | null>, unknown[]>;
};

type UsuarioModelMock = {
  findById: jest.Mock<QueryMock<UsuarioDocument | null>, unknown[]>;
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
  let almacenModelMock: AlmacenModelMock;
  let productoModelMock: ProductoModelMock;
  let paisModelMock: PaisModelMock;
  let usuarioModelMock: UsuarioModelMock;
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
    productoId: PRODUCTO_ID,
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
    facturaModelMock.find = jest.fn<QueryMock<Factura[]>, unknown[]>();
    facturaModelMock.findOne = jest.fn<QueryMock<Factura | null>, unknown[]>();
    facturaModelMock.findOneAndUpdate = jest.fn<
      QueryMock<Factura | null>,
      unknown[]
    >();

    facturaContadorModelMock = {
      findOneAndUpdate: jest.fn<QueryMock<FacturaContador | null>, unknown[]>(),
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

    // Default happy path: a valid almacén (with codigo) and, when the item
    // uses PRODUCTO_ID, a producto with no almacen assigned (so it matches
    // any almacenId). Individual tests override these for the T2 cases.
    almacenModelMock = {
      findById: jest.fn<QueryMock<AlmacenDocument | null>, unknown[]>(),
    };
    almacenModelMock.findById.mockReturnValue(
      crearQueryMock<AlmacenDocument | null>({
        _id: ALMACEN_ID,
        nombreAlmacen: 'Almacén Central',
        codigo: 'ALM-001',
      } as AlmacenDocument),
    );

    productoModelMock = {
      find: jest.fn<QueryMock<ProductoDocument[]>, unknown[]>(),
    };
    productoModelMock.find.mockReturnValue(
      crearQueryMock<ProductoDocument[]>([
        { _id: PRODUCTO_ID, almacen: undefined } as unknown as ProductoDocument,
      ]),
    );

    // Default: no país resolved (undefined empresa.pais never even calls
    // this). Individual T3 tests override it to a found/missing Pais doc.
    paisModelMock = {
      findById: jest.fn<QueryMock<PaisDocument | null>, unknown[]>(),
    };
    paisModelMock.findById.mockReturnValue(
      crearQueryMock<PaisDocument | null>(null),
    );

    // Default happy path (T4): the authenticated user exists and is
    // snapshotted into facturadoPor. Individual T4 tests override this to
    // simulate the account having been deleted after login (401).
    usuarioModelMock = {
      findById: jest.fn<QueryMock<UsuarioDocument | null>, unknown[]>(),
    };
    usuarioModelMock.findById.mockReturnValue(
      crearQueryMock<UsuarioDocument | null>({
        _id: USER_ID,
        nombre_empleado: 'Juan Pérez',
        ci_empleado: '12345678901',
      } as UsuarioDocument),
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
        { provide: getModelToken(Almacen.name), useValue: almacenModelMock },
        { provide: getModelToken(Producto.name), useValue: productoModelMock },
        { provide: getModelToken(Pais.name), useValue: paisModelMock },
        { provide: getModelToken(Usuario.name), useValue: usuarioModelMock },
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
      almacenId: ALMACEN_ID,
      items: [{ ...itemBase }],
    };
  }

  /**
   * `FacturaService.create` now requires the authenticated user id (T4).
   * Every pre-T4 test below only cares about invoice behaviour, not about
   * facturadoPor, so this wrapper defaults userId to a user the mocked
   * `usuarioModel` resolves, keeping those call sites unchanged in intent.
   */
  function crear(
    dto: CreateFacturaDto,
    userId: string = USER_ID,
  ): Promise<Factura> {
    return service.create(dto, userId);
  }

  describe('numeracion atomica (T1)', () => {
    it('allocates the invoice number via an atomic $inc on the counter', async () => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 5 }),
      );

      await crear(baseDto());

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

      await crear(dto);

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

      await crear(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.subtotal).toBe(200);
      expect(construidoCon.total).toBe(200);
    });

    it('always sets estado to confirmada for a new invoice, ignoring any client-sent estado', async () => {
      const dto = {
        ...baseDto(),
        estado: 'anulada',
      } as unknown as CreateFacturaDto;

      await crear(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.estado).toBe('confirmada');
    });

    it('computes tax importe from porciento server-side', async () => {
      const dto = {
        ...baseDto(),
        items: [{ ...itemBase, cantidad: 1, precio: 100 }],
        impuesto: { tipo: 'ISV', porciento: 10, importe: 1 },
      } as unknown as CreateFacturaDto;

      await crear(dto);

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

      await crear(dto);

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
      await crear(baseDto());

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.emisor).toBeUndefined();
    });

    it('copies ciudad and resolves pais from the Pais nomenclador (T3)', async () => {
      (empresaDatosServiceMock.obtener as jest.Mock).mockResolvedValueOnce({
        nombre: 'Empresa Real S.A.',
        ruc_nit: '111-REAL',
        direccion: 'Dir real',
        telefono: '000',
        email: 'real@empresa.com',
        ciudad: 'La Habana',
        pais: '507f1f77bcf86cd799439099',
      });
      paisModelMock.findById.mockReturnValue(
        crearQueryMock<PaisDocument | null>({
          _id: '507f1f77bcf86cd799439099',
          nombrePais: 'Cuba',
        } as PaisDocument),
      );

      await crear(baseDto());

      expect(paisModelMock.findById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439099',
      );
      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(comoRegistro(construidoCon.emisor)).toEqual({
        nombre: 'Empresa Real S.A.',
        nit: '111-REAL',
        direccion: 'Dir real',
        telefono: '000',
        email: 'real@empresa.com',
        ciudad: 'La Habana',
        pais: 'Cuba',
      });
    });

    it('leaves pais undefined when EmpresaDatos has no pais configured, without querying the Pais model', async () => {
      (empresaDatosServiceMock.obtener as jest.Mock).mockResolvedValueOnce({
        nombre: 'Empresa Real S.A.',
        ciudad: 'La Habana',
      });

      await crear(baseDto());

      expect(paisModelMock.findById).not.toHaveBeenCalled();
      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(comoRegistro(construidoCon.emisor).pais).toBeUndefined();
    });

    it('leaves pais undefined when the referenced Pais document no longer exists', async () => {
      (empresaDatosServiceMock.obtener as jest.Mock).mockResolvedValueOnce({
        nombre: 'Empresa Real S.A.',
        pais: '507f1f77bcf86cd799439099',
      });
      paisModelMock.findById.mockReturnValue(
        crearQueryMock<PaisDocument | null>(null),
      );

      await crear(baseDto());

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(comoRegistro(construidoCon.emisor).pais).toBeUndefined();
    });
  });

  describe('participantes: despachadoPor / transportadoPor / recibidoPor (T3)', () => {
    beforeEach(() => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );
    });

    it('persists despachadoPor, transportadoPor and recibidoPor on create', async () => {
      const participante = {
        nombre: 'Juan Perez',
        ci: '12345678901',
        fecha: '2026-09-22',
      };
      const dto = {
        ...baseDto(),
        despachadoPor: participante,
        transportadoPor: { ...participante, nombre: 'Ana Lopez' },
        recibidoPor: { ...participante, nombre: 'Luis Diaz' },
      } as unknown as CreateFacturaDto;

      await crear(dto);

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.despachadoPor).toEqual(participante);
      expect(comoRegistro(construidoCon.transportadoPor).nombre).toBe(
        'Ana Lopez',
      );
      expect(comoRegistro(construidoCon.recibidoPor).nombre).toBe('Luis Diaz');
    });

    it('leaves the participants undefined when not sent', async () => {
      await crear(baseDto());

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.despachadoPor).toBeUndefined();
      expect(construidoCon.transportadoPor).toBeUndefined();
      expect(construidoCon.recibidoPor).toBeUndefined();
    });

    it('passes the participants through on update, like any other allowed field', async () => {
      const actualizada = { id: 'FAC-000001' } as Factura;
      facturaModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock<Factura | null>(actualizada),
      );

      const dto: UpdateFacturaDto = {
        recibidoPor: {
          nombre: 'Luis Diaz',
          ci: '12345678901',
          fecha: '2026-09-22',
        },
      };
      await service.update('FAC-000001', dto);

      expect(facturaModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { id: 'FAC-000001', estado: { $ne: 'anulada' } },
        dto,
        { new: true, runValidators: true },
      );
    });
  });

  describe('almacén y productos de la factura (warehouse T2)', () => {
    beforeEach(() => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );
    });

    it('loads the almacén by id and persists almacenId + the codigo snapshot', async () => {
      await crear(baseDto());

      expect(almacenModelMock.findById).toHaveBeenCalledWith(ALMACEN_ID);
      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.almacenId).toBe(ALMACEN_ID);
      expect(construidoCon.almacenCodigo).toBe('ALM-001');
    });

    it('throws NotFoundException when the almacén does not exist, without burning a numero', async () => {
      almacenModelMock.findById.mockReturnValue(
        crearQueryMock<AlmacenDocument | null>(null),
      );

      await expect(crear(baseDto())).rejects.toBeInstanceOf(NotFoundException);
      expect(facturaContadorModelMock.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when the almacén has no codigo configured, without burning a numero', async () => {
      almacenModelMock.findById.mockReturnValue(
        crearQueryMock<AlmacenDocument | null>({
          _id: ALMACEN_ID,
          nombreAlmacen: 'Almacén Sin Código',
          codigo: undefined,
        } as AlmacenDocument),
      );

      await expect(crear(baseDto())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(facturaContadorModelMock.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('loads every referenced producto in a single $in query, deduplicating repeated productoId', async () => {
      const dto = {
        ...baseDto(),
        items: [
          { ...itemBase, id: 'item-1' },
          { ...itemBase, id: 'item-2' },
        ],
      } as CreateFacturaDto;

      await crear(dto);

      expect(productoModelMock.find).toHaveBeenCalledTimes(1);
      expect(productoModelMock.find).toHaveBeenCalledWith({
        _id: { $in: [PRODUCTO_ID] },
      });
    });

    it('throws BadRequestException naming the productoId when the product does not exist, without burning a numero', async () => {
      productoModelMock.find.mockReturnValue(
        crearQueryMock<ProductoDocument[]>([]),
      );

      await expect(crear(baseDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(crear(baseDto())).rejects.toThrow(PRODUCTO_ID);
      expect(facturaContadorModelMock.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException naming the productoId when the producto belongs to a different almacén', async () => {
      productoModelMock.find.mockReturnValue(
        crearQueryMock<ProductoDocument[]>([
          {
            _id: PRODUCTO_ID,
            almacen: 'otro-almacen-id',
          } as unknown as ProductoDocument,
        ]),
      );

      await expect(crear(baseDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(crear(baseDto())).rejects.toThrow(PRODUCTO_ID);
    });

    it('allows the producto when its almacen matches the invoice almacenId', async () => {
      productoModelMock.find.mockReturnValue(
        crearQueryMock<ProductoDocument[]>([
          {
            _id: PRODUCTO_ID,
            almacen: ALMACEN_ID,
          } as unknown as ProductoDocument,
        ]),
      );

      await expect(crear(baseDto())).resolves.toBeDefined();
    });

    it('matches the producto almacen against an uppercase-hex almacenId using canonical ObjectId equality', async () => {
      productoModelMock.find.mockReturnValue(
        crearQueryMock<ProductoDocument[]>([
          {
            _id: PRODUCTO_ID,
            almacen: ALMACEN_ID,
          } as unknown as ProductoDocument,
        ]),
      );
      const dto = {
        ...baseDto(),
        almacenId: ALMACEN_ID.toUpperCase(),
      };

      await expect(crear(dto)).resolves.toBeDefined();
    });

    it('finds the producto when productoId is sent in uppercase hex, matching the canonical stored _id', async () => {
      productoModelMock.find.mockReturnValue(
        crearQueryMock<ProductoDocument[]>([
          {
            _id: PRODUCTO_ID,
            almacen: undefined,
          } as unknown as ProductoDocument,
        ]),
      );
      const dto = {
        ...baseDto(),
        items: [{ ...itemBase, productoId: PRODUCTO_ID.toUpperCase() }],
      };

      await expect(crear(dto)).resolves.toBeDefined();
    });

    it('loads the almacén by the exact almacenId given, letting Mongoose handle case-insensitive ObjectId casting', async () => {
      const almacenIdMayuscula = ALMACEN_ID.toUpperCase();
      const dto = {
        ...baseDto(),
        almacenId: almacenIdMayuscula,
      };

      await crear(dto);

      expect(almacenModelMock.findById).toHaveBeenCalledWith(
        almacenIdMayuscula,
      );
    });
  });

  describe('no burned invoice numbers (T9)', () => {
    it('validates the document, skipping numero/id, before allocating a number', async () => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );

      await crear(baseDto());

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

      await expect(crear(baseDto())).rejects.toThrow('datos invalidos');

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
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );
      savedFactura.save.mockRejectedValueOnce(new Error('fallo al guardar'));
      const advertir = jest.spyOn(Logger.prototype, 'warn');

      await expect(crear(baseDto())).rejects.toThrow('fallo al guardar');

      expect(facturaModelMock.findOne).toHaveBeenCalledWith({ numero: 5 });
      expect(facturaContadorModelMock.findOneAndUpdate).toHaveBeenNthCalledWith(
        2,
        { _id: FACTURA_CONTADOR_ID, seq: 5 },
        { $inc: { seq: -1 } },
      );
      expect(advertir).toHaveBeenCalledWith(expect.stringContaining('5'));
    });

    it('never releases the number when save fails with a duplicate key (avoids a re-allocation livelock)', async () => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValueOnce(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 5 }),
      );
      const duplicado = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      });
      savedFactura.save.mockRejectedValueOnce(duplicado);
      const errorLog = jest.spyOn(Logger.prototype, 'error');

      await expect(crear(baseDto())).rejects.toBe(duplicado);

      expect(facturaContadorModelMock.findOneAndUpdate).toHaveBeenCalledTimes(
        1,
      );
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('5'));
    });

    it('never releases the number when an invoice with it was actually persisted (ambiguous write failure)', async () => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValueOnce(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 5 }),
      );
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock<Factura | null>({ numero: 5 } as Factura),
      );
      savedFactura.save.mockRejectedValueOnce(new Error('socket timeout'));

      await expect(crear(baseDto())).rejects.toThrow('socket timeout');

      expect(facturaModelMock.findOne).toHaveBeenCalledWith({ numero: 5 });
      expect(facturaContadorModelMock.findOneAndUpdate).toHaveBeenCalledTimes(
        1,
      );
    });

    it('logs an error naming the burned numero when the rollback does not match', async () => {
      facturaContadorModelMock.findOneAndUpdate
        .mockReturnValueOnce(
          crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 5 }),
        )
        .mockReturnValueOnce(crearQueryMock<FacturaContador | null>(null));
      facturaModelMock.findOne.mockReturnValue(
        crearQueryMock<Factura | null>(null),
      );
      savedFactura.save.mockRejectedValueOnce(new Error('fallo al guardar'));
      const errorLog = jest.spyOn(Logger.prototype, 'error');

      await expect(crear(baseDto())).rejects.toThrow('fallo al guardar');

      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('5'));
    });
  });

  describe('facturadoPor: authenticated user snapshot (T4)', () => {
    beforeEach(() => {
      facturaContadorModelMock.findOneAndUpdate.mockReturnValue(
        crearQueryMock({ _id: FACTURA_CONTADOR_ID, seq: 1 }),
      );
    });

    it("snapshots nombre, ci, empleadoId and today's fecha from the authenticated user", async () => {
      usuarioModelMock.findById.mockReturnValue(
        crearQueryMock<UsuarioDocument | null>({
          _id: USER_ID,
          nombre_empleado: 'María López',
          ci_empleado: '98765432109',
        } as UsuarioDocument),
      );

      await crear(baseDto(), USER_ID);

      expect(usuarioModelMock.findById).toHaveBeenCalledWith(USER_ID);
      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(comoRegistro(construidoCon).facturadoPor).toEqual({
        empleadoId: USER_ID,
        nombre: 'María López',
        ci: '98765432109',
        fecha: obtenerFechaEnZona(FACTURA_TIMEZONE),
      });
    });

    it('throws 401 when the authenticated user no longer exists (deleted after login)', async () => {
      usuarioModelMock.findById.mockReturnValue(
        crearQueryMock<UsuarioDocument | null>(null),
      );

      await expect(crear(baseDto(), USER_ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(facturaModelMock).not.toHaveBeenCalled();
    });

    it('never allocates a number when the authenticated user no longer exists (T9 rule)', async () => {
      usuarioModelMock.findById.mockReturnValue(
        crearQueryMock<UsuarioDocument | null>(null),
      );

      await expect(crear(baseDto(), USER_ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(facturaContadorModelMock.findOneAndUpdate).not.toHaveBeenCalled();
      expect(savedFactura.save).not.toHaveBeenCalled();
    });

    it('looks up the employee before allocating the invoice number (T9 rule)', async () => {
      await crear(baseDto(), USER_ID);

      const ordenBusquedaUsuario =
        usuarioModelMock.findById.mock.invocationCallOrder[0];
      const ordenAsignacionNumero =
        facturaContadorModelMock.findOneAndUpdate.mock.invocationCallOrder[0];
      expect(ordenBusquedaUsuario).toBeLessThan(ordenAsignacionNumero);
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

      await crear(baseDto());

      const construidoCon = facturaModelMock.mock.calls[0][0];
      expect(construidoCon.fecha).toBe('2026-09-22');
    });

    it('uses the client-sent fecha as-is when provided', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-23T02:00:00Z'));

      const dto = { ...baseDto(), fecha: '2020-01-01' } as CreateFacturaDto;
      await crear(dto);

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

    it('auto-creates a client that passes the real Cliente schema when no direccion is sent', async () => {
      const dto = { ...baseDto(), nit: 'NIT-1' } as CreateFacturaDto;

      await crear(dto);

      expect(clienteModelMock).toHaveBeenCalledTimes(1);
      const datosCliente = clienteModelMock.mock.calls[0][0];
      const ClienteReal = mongoose.model(
        'ClienteValidacionSpec',
        ClienteSchema,
      );
      await expect(
        new ClienteReal(datosCliente).validate(),
      ).resolves.toBeUndefined();
      expect(datosCliente.direccion_cliente).toBe(
        FACTURA_CLIENTE_DIRECCION_PLACEHOLDER,
      );
    });

    it('keeps the direccion sent by the buyer when the client is auto-created', async () => {
      const dto = {
        ...baseDto(),
        nit: 'NIT-1',
        direccion: 'Calle 1',
      } as CreateFacturaDto;

      await crear(dto);

      expect(clienteModelMock.mock.calls[0][0].direccion_cliente).toBe(
        'Calle 1',
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
      await crear(dto);

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
      await crear(dto);

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
      await crear(dto);

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
      await crear(dto);

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
      const resultado = await crear(dto);

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
      const resultado = await crear(dto);

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
