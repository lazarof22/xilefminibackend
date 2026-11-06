import { Types } from 'mongoose';
import { devolucionesEfectivoEnVentana } from './devolucion-efectivo.util';
import {
  EstadoDevolucion,
  FormaDevolucionDinero,
} from './schema/devolucion.schema';

describe('devolucionesEfectivoEnVentana', () => {
  const crearModelo = (filas: { montoDevuelto: number; moneda: string }[]) => {
    const exec = jest.fn().mockResolvedValue(filas);
    const lean = jest.fn().mockReturnValue({ exec });
    const select = jest.fn().mockReturnValue({ lean });
    const find = jest.fn().mockReturnValue({ select });
    return { modelo: { find } as never, find, select };
  };

  it('asks only for registered cash returns inside the window', async () => {
    const { modelo, find, select } = crearModelo([]);
    const desde = new Date('2026-11-03T08:00:00Z');
    const hasta = new Date('2026-11-03T20:00:00Z');

    await devolucionesEfectivoEnVentana(modelo, desde, hasta);

    expect(find).toHaveBeenCalledWith({
      formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
      estado: EstadoDevolucion.REGISTRADA,
      fecha: { $gte: desde, $lte: hasta },
    });
    expect(select).toHaveBeenCalledWith('montoDevuelto moneda');
  });

  it('maps each return to a per-currency cash movement', async () => {
    const { modelo } = crearModelo([
      { montoDevuelto: 150, moneda: 'CUP' },
      { montoDevuelto: 20, moneda: 'USD' },
    ]);

    const movimientos = await devolucionesEfectivoEnVentana(
      modelo,
      new Date(0),
      new Date(),
    );

    expect(movimientos).toEqual([
      { monto: 150, moneda: 'CUP' },
      { monto: 20, moneda: 'USD' },
    ]);
  });

  it('with a turno, counts the vales stamped with it and only the unstamped ones by date', async () => {
    const { modelo, find } = crearModelo([]);
    const desde = new Date('2026-11-03T08:00:00Z');
    const hasta = new Date('2026-11-03T20:00:00Z');
    const turno = new Types.ObjectId();

    await devolucionesEfectivoEnVentana(modelo, desde, hasta, turno);

    expect(find).toHaveBeenCalledWith({
      formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
      estado: EstadoDevolucion.REGISTRADA,
      $or: [
        { turnoCaja: turno },
        { turnoCaja: { $exists: false }, fecha: { $gte: desde, $lte: hasta } },
      ],
    });
  });
});
