import { redondear } from '../reporte_plus/efectivo-turno.util';

/**
 * Costo promedio móvil ponderado del Submayor SC-2-13 (doc §6.6).
 *
 * Funciones puras: quien las usa lee los datos (último promedio del kardex,
 * precio de compra del producto, saldo previo) y las pasa aquí. Todo importe
 * y costo se redondea a 2 decimales con el mismo `redondear` de Caja.
 */

const esCostoValido = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;

export interface DatosPromedio {
  /** Saldo total del producto ANTES de la entrada. */
  stockAnterior: number;
  /** Costo promedio vigente antes de la entrada. */
  costoPromedioAnterior: number;
  /** Cantidad que entra. */
  cantidad: number;
  /** Costo unitario de la entrada. */
  costoUnitario: number;
}

/**
 * `nuevo = (stockAnterior × promedioAnterior + cantidad × costoUnitario)
 *          / (stockAnterior + cantidad)`.
 * Sin saldo previo (0 o negativo) el promedio es el costo de la entrada.
 */
export function calcularCostoPromedio(datos: DatosPromedio): number {
  const { stockAnterior, costoPromedioAnterior, cantidad, costoUnitario } =
    datos;
  if (!(stockAnterior > 0)) return redondear(costoUnitario);

  const valorAnterior = stockAnterior * costoPromedioAnterior;
  const valorEntrada = cantidad * costoUnitario;
  return redondear((valorAnterior + valorEntrada) / (stockAnterior + cantidad));
}

/**
 * Costo vigente de un producto: el `costoPromedio` del último movimiento del
 * kardex; si no hay, `Producto.precio_compra` (solo si es mayor que 0: un 0
 * es el valor sin capturar). `undefined` si no hay ninguno: no se inventa.
 */
export function costoVigente(
  ultimoPromedio: number | undefined,
  precioCompra: number | undefined,
): number | undefined {
  if (esCostoValido(ultimoPromedio)) return redondear(ultimoPromedio);
  if (esCostoValido(precioCompra) && precioCompra > 0) {
    return redondear(precioCompra);
  }
  return undefined;
}

export interface DatosEntrada {
  ultimoPromedio?: number;
  precioCompra?: number;
  stockAnterior: number;
  cantidad: number;
  costoUnitario: number;
}

/**
 * Nuevo promedio tras una ENTRADA con costo conocido. El promedio anterior
 * sale, en este orden, de: 1) el último `costoPromedio` del kardex,
 * 2) `Producto.precio_compra`, 3) el propio costo de la entrada.
 */
export function costoParaEntrada(datos: DatosEntrada): number {
  const anterior =
    costoVigente(datos.ultimoPromedio, datos.precioCompra) ??
    datos.costoUnitario;

  return calcularCostoPromedio({
    stockAnterior: datos.stockAnterior,
    costoPromedioAnterior: anterior,
    cantidad: datos.cantidad,
    costoUnitario: datos.costoUnitario,
  });
}

/**
 * Campos contables de un movimiento valuado a `costo` (el promedio vigente
 * para salidas, el nuevo promedio para entradas con costo). Sin costo no se
 * escribe nada.
 */
export function valuarMovimiento(
  cantidad: number,
  costo: number | undefined,
): { costoPromedio?: number; importeCUP?: number } {
  if (!esCostoValido(costo)) return {};
  return { costoPromedio: costo, importeCUP: redondear(cantidad * costo) };
}
