import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { TransferenciaService } from './transferencia.service';
import { Transferencia } from './schema/transferencia.schema';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';
import { Existencia } from '../exitencia/schema/existencia.schema';
import { ExistenciaService } from '../exitencia/existencia.service';

/** Chainable query: `session/select/sort/lean` return itself, `then/exec` resolve. */
const query = <T>(valor: T | Error) => {
  const q: Record<string, unknown> = {};
  for (const m of ['session', 'select', 'sort', 'lean']) q[m] = () => q;
  const resolver = () =>
    valor instanceof Error ? Promise.reject(valor) : Promise.resolve(valor);
  q.exec = resolver;
  q.then = (ok: (v: T) => unknown, ko: (e: unknown) => unknown) =>
    resolver().then(ok, ko);
  return q;
};

describe('TransferenciaService — valuación del Kardex (SC-2-13)', () => {
  const productoId = new Types.ObjectId();
  const almacenOrigen = { _id: new Types.ObjectId(), nombreAlmacen: 'Central' };
  const almacenDestino = { _id: new Types.ObjectId(), nombreAlmacen: 'Tienda' };
  const contenedorOrigen = { _id: new Types.ObjectId(), almacen: almacenOrigen._id };
  const contenedorDestino = { _id: new Types.ObjectId(), almacen: almacenDestino._id };

  let service: TransferenciaService;
  let kardexModel: { create: jest.Mock; findOne: jest.Mock };
  let productoModel: { findById: jest.Mock };
  let warnSpy: jest.SpyInstance;

  const dto = () => ({
    almacen_origen: almacenOrigen._id.toHexString(),
    almacen_destino: almacenDestino._id.toHexString(),
    contenedor_origen: contenedorOrigen._id.toHexString(),
    contenedor_destino: contenedorDestino._id.toHexString(),
    producto: productoId.toHexString(),
    cantidad: 4,
  });

  /** Rows passed to the (single) `kardexModel.create` call. */
  const filasKardex = () =>
    (kardexModel.create.mock.calls[0] as unknown[][])[0] as Record<
      string,
      unknown
    >[];

  beforeEach(async () => {
    kardexModel = {
      create: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(() => query(null)),
    };
    productoModel = {
      findById: jest.fn(() =>
        query({ _id: productoId, precio_compra: 0 }),
      ),
    };
    const existencia = {
      disminuir: jest.fn().mockResolvedValue({ cantidad: 6 }),
      aumentar: jest.fn().mockResolvedValue({ cantidad: 14 }),
    };

    const modulo = await Test.createTestingModule({
      providers: [
        TransferenciaService,
        {
          provide: getModelToken(Transferencia.name),
          useValue: {
            create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
            deleteOne: jest.fn(),
          },
        },
        {
          provide: getModelToken(Almacen.name),
          useValue: { find: jest.fn(() => query([almacenOrigen, almacenDestino])) },
        },
        {
          provide: getModelToken(Contenedor.name),
          useValue: {
            find: jest.fn(() => query([contenedorOrigen, contenedorDestino])),
          },
        },
        { provide: getModelToken(Producto.name), useValue: productoModel },
        { provide: getModelToken(Kardex.name), useValue: kardexModel },
        { provide: getModelToken(Existencia.name), useValue: {} },
        // No `db`: transactions are reported as unsupported, plain path.
        { provide: getConnectionToken(), useValue: {} },
        { provide: ExistenciaService, useValue: existencia },
      ],
    }).compile();

    service = modulo.get(TransferenciaService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('values both movements at the latest Kardex average cost', async () => {
    kardexModel.findOne.mockReturnValue(query({ costoPromedio: 6.5 }));
    productoModel.findById.mockReturnValue(
      query({ _id: productoId, precio_compra: 4 }),
    );

    await service.create(dto());

    const filas = filasKardex();
    expect(filas).toHaveLength(2);
    expect(filas[0]).toEqual(
      expect.objectContaining({
        tipo: KardexTipo.TRANSFERENCIA_SALIDA,
        cantidad: 4,
        costoPromedio: 6.5,
        importeCUP: 26,
      }),
    );
    expect(filas[1]).toEqual(
      expect.objectContaining({
        tipo: KardexTipo.TRANSFERENCIA_ENTRADA,
        cantidad: 4,
        costoPromedio: 6.5,
        importeCUP: 26,
      }),
    );
  });

  it('falls back to Producto.precio_compra when the Kardex has no average', async () => {
    productoModel.findById.mockReturnValue(
      query({ _id: productoId, precio_compra: 4 }),
    );

    await service.create(dto());

    for (const fila of filasKardex()) {
      expect(fila).toEqual(
        expect.objectContaining({ costoPromedio: 4, importeCUP: 16 }),
      );
    }
  });

  it('a failing cost read still writes both entries unvalued and the transfer succeeds', async () => {
    kardexModel.findOne.mockReturnValue(query(new Error('db caído')));

    await expect(service.create(dto())).resolves.toBeDefined();

    const filas = filasKardex();
    expect(filas).toHaveLength(2);
    for (const fila of filas) {
      expect(fila).not.toHaveProperty('costoPromedio');
      expect(fila).not.toHaveProperty('importeCUP');
      expect(fila).toEqual(
        expect.objectContaining({ productoId, cantidad: 4 }),
      );
    }
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No se pudo valuar la salida del producto'),
    );
  });
});
