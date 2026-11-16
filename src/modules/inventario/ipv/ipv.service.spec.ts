import { Types } from 'mongoose';
import { IpvService } from './ipv.service';
import { KardexTipo } from '../kardex/schema/kardex.schema';

const consulta = <T>(valor: T) => ({
  sort: () => consulta(valor),
  lean: () => consulta(valor),
  exec: () => Promise.resolve(valor),
});

describe('IpvService.obtenerDia', () => {
  const productoId = new Types.ObjectId();
  const producto = {
    _id: productoId,
    nombre_producto: 'Cerveza',
    codigo_producto: 'UIB-Cerveza',
    precio_compra: 1,
    precio_venta: 2,
    stock_inicial: 37,
  };

  function crear(opts: {
    kardex: { tipo: KardexTipo; cantidad: number }[];
    anteriorFinal?: number;
  }) {
    const ventaModel = {
      aggregate: jest.fn(() => consulta([])),
    };
    const kardexModel = {
      aggregate: jest.fn(() =>
        consulta(
          opts.kardex.map((m) => ({
            _id: { producto: productoId, tipo: m.tipo },
            cantidad: m.cantidad,
          })),
        ),
      ),
    };
    const ipvModel = {
      find: jest.fn(() => consulta([])),
      aggregate: jest.fn(() =>
        consulta(
          opts.anteriorFinal === undefined
            ? []
            : [{ _id: productoId, inventarioFinal: opts.anteriorFinal }],
        ),
      ),
    };
    const productoModel = { find: jest.fn(() => consulta([producto])) };
    return new IpvService(
      ipvModel as never,
      productoModel as never,
      ventaModel as never,
      kardexModel as never,
    );
  }

  it('counts confirmed invoice sales (Kardex VENTA) so Final equals the real stock', async () => {
    const servicio = crear({
      anteriorFinal: 42,
      kardex: [{ tipo: KardexTipo.VENTA, cantidad: 5 }],
    });
    const { items } = await servicio.obtenerDia('2026-11-15');
    expect(items[0]).toMatchObject({
      inventarioInicial: 42,
      venta: 5,
      entradas: 0,
      inventarioFinal: 37,
    });
  });

  it('keeps cancellations and returns as entradas, so sale plus return nets to the stock', async () => {
    const servicio = crear({
      anteriorFinal: 42,
      kardex: [
        { tipo: KardexTipo.VENTA, cantidad: 7 },
        { tipo: KardexTipo.DEVOLUCION, cantidad: 2 },
      ],
    });
    const { items } = await servicio.obtenerDia('2026-11-15');
    expect(items[0]).toMatchObject({
      venta: 7,
      entradas: 2,
      inventarioFinal: 37,
    });
  });
});
