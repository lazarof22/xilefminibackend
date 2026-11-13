/**
 * Canales por los que puede llegar una transferencia. Zelle es un CANAL de
 * pago (la plataforma por la que se envía el dinero), no una moneda: lo que se
 * transfiere por Zelle son dólares (USD).
 *
 * El conjunto es cerrado y cada canal tiene reglas propias, por eso vive en el
 * código y no en la base de datos.
 */
export const CANALES_PAGO = [
  {
    codigo: 'banco',
    nombre: 'Transferencia bancaria',
    monedaPorDefecto: 'CUP',
    requiereBanco: true,
  },
  {
    codigo: 'transfermovil',
    nombre: 'Transfermóvil',
    monedaPorDefecto: 'CUP',
    requiereBanco: false,
  },
  {
    codigo: 'enzona',
    nombre: 'EnZona',
    monedaPorDefecto: 'CUP',
    requiereBanco: false,
  },
  {
    codigo: 'zelle',
    nombre: 'Zelle',
    monedaPorDefecto: 'USD',
    requiereBanco: false,
  },
] as const;

export type CanalPago = (typeof CANALES_PAGO)[number]['codigo'];

export const CODIGOS_CANAL_PAGO = CANALES_PAGO.map(
  (c) => c.codigo,
) as unknown as readonly CanalPago[];

/** Canal que se asume cuando el cobro no lo indica (el diálogo anterior solo conocía el banco). */
export const CANAL_PAGO_POR_DEFECTO: CanalPago = 'banco';

export function buscarCanal(codigo: string | undefined) {
  return CANALES_PAGO.find(
    (c) => c.codigo === (codigo ?? CANAL_PAGO_POR_DEFECTO),
  );
}
