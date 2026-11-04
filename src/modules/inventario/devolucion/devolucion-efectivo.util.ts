import { Model } from 'mongoose';
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
 * la caja. El vale no guarda el turno ni el cajero, por eso se cruza por fecha.
 */
export async function devolucionesEfectivoEnVentana(
  modelo: Model<Devolucion>,
  desde: Date,
  hasta: Date,
): Promise<MovimientoMoneda[]> {
  const filas = (await modelo
    .find({
      formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
      estado: EstadoDevolucion.REGISTRADA,
      fecha: { $gte: desde, $lte: hasta },
    })
    .select('montoDevuelto moneda')
    .lean()
    .exec()) as unknown as { montoDevuelto: number; moneda?: string }[];
  return filas.map((f) => ({ monto: f.montoDevuelto, moneda: f.moneda }));
}
