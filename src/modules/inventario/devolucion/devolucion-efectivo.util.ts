import { Model, Types } from 'mongoose';
import type { MovimientoMoneda } from '../reporte_plus/efectivo-turno.util';
import {
  Devolucion,
  EstadoDevolucion,
  FormaDevolucionDinero,
} from './schema/devolucion.schema';

/**
 * Devoluciones pagadas en efectivo dentro de una ventana de tiempo, como
 * movimientos por moneda. Son una SALIDA física de caja: la usan el cuadre, el
 * arqueo y el resumen del Reporte Plus para calcular el efectivo esperado.
 *
 * Solo cuentan los vales `registrada` con forma `efectivo`; una devolución a
 * crédito (`descuenta_deuda`) o por transferencia (`nota_credito`) no mueve
 * la caja. Un vale registrado con un turno abierto lleva su `turnoCaja`: con
 * `turnoId` se cuenta solo en ese turno (no en otro cuya ventana lo contenga).
 * Los vales sin turno (anteriores o de quien no tenía uno abierto) se siguen
 * cruzando por fecha.
 */
export async function devolucionesEfectivoEnVentana(
  modelo: Model<Devolucion>,
  desde: Date,
  hasta: Date,
  turnoId?: Types.ObjectId,
): Promise<MovimientoMoneda[]> {
  const ventana = { $gte: desde, $lte: hasta };
  const alcance = turnoId
    ? {
        $or: [
          { turnoCaja: turnoId },
          { turnoCaja: { $exists: false }, fecha: ventana },
        ],
      }
    : { fecha: ventana };
  const filas = (await modelo
    .find({
      formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
      estado: EstadoDevolucion.REGISTRADA,
      ...alcance,
    })
    .select('montoDevuelto moneda')
    .lean()
    .exec()) as unknown as { montoDevuelto: number; moneda?: string }[];
  return filas.map((f) => ({ monto: f.montoDevuelto, moneda: f.moneda }));
}
