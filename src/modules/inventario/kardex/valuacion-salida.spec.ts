import { Types } from 'mongoose';
import { costoDeSalida } from './valuacion-salida';

const chain = <T>(valor: T | Error) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['select', 'sort', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(() =>
    valor instanceof Error ? Promise.reject(valor) : Promise.resolve(valor),
  );
  return c;
};

describe('costoDeSalida', () => {
  const productoId = new Types.ObjectId();
  let kardexModel: { findOne: jest.Mock };
  let productoModel: { findById: jest.Mock };
  let logger: { warn: jest.Mock };

  beforeEach(() => {
    kardexModel = { findOne: jest.fn(() => chain(null)) };
    productoModel = { findById: jest.fn(() => chain(null)) };
    logger = { warn: jest.fn() };
  });

  it('uses the latest average cost of the Kardex when there is one', async () => {
    kardexModel.findOne.mockReturnValue(chain({ costoPromedio: 6.5 }));
    productoModel.findById.mockReturnValue(chain({ precio_compra: 4 }));

    await expect(
      costoDeSalida(kardexModel as never, productoModel as never, productoId),
    ).resolves.toBe(6.5);
  });

  it('falls back to Producto.precio_compra when the Kardex has no average', async () => {
    productoModel.findById.mockReturnValue(chain({ precio_compra: 4 }));

    await expect(
      costoDeSalida(kardexModel as never, productoModel as never, productoId),
    ).resolves.toBe(4);
  });

  it('returns undefined when there is neither an average nor a purchase price', async () => {
    productoModel.findById.mockReturnValue(chain({ precio_compra: 0 }));

    await expect(
      costoDeSalida(kardexModel as never, productoModel as never, productoId),
    ).resolves.toBeUndefined();
  });

  it('accepts the product id as a hex string', async () => {
    kardexModel.findOne.mockReturnValue(chain({ costoPromedio: 3 }));

    await expect(
      costoDeSalida(
        kardexModel as never,
        productoModel as never,
        productoId.toHexString(),
      ),
    ).resolves.toBe(3);
  });

  it('never throws: a failing read logs a warning and returns undefined', async () => {
    kardexModel.findOne.mockReturnValue(chain(new Error('db caído')));

    await expect(
      costoDeSalida(
        kardexModel as never,
        productoModel as never,
        productoId,
        logger,
      ),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No se pudo valuar la salida del producto'),
    );
  });

  it('does not throw when the models themselves are broken and no logger is given', async () => {
    await expect(
      costoDeSalida({} as never, {} as never, productoId),
    ).resolves.toBeUndefined();
  });
});
