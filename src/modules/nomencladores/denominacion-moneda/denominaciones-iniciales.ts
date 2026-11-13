import type { TipoDenominacion } from './schema/denominacion-moneda.schema';

export interface DenominacionInicial {
  moneda: string;
  valor: number;
  tipo: TipoDenominacion;
}

const de = (
  moneda: string,
  valores: number[],
  tipo: TipoDenominacion = 'billete',
): DenominacionInicial[] => valores.map((valor) => ({ moneda, valor, tipo }));

/**
 * Denominaciones con las que se llena el nomenclador la primera vez (solo si
 * la colección está vacía): las mismas que ya mostraba el desglose del punto de
 * venta. CUP hasta 5000; USD y EUR hasta 100. Se pueden añadir, desactivar o
 * cambiar después desde `/denominacion-moneda`.
 */
export const DENOMINACIONES_INICIALES: DenominacionInicial[] = [
  ...de('CUP', [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 3, 1]),
  ...de('USD', [100, 50, 20, 10, 5, 1]),
  ...de('EUR', [100, 50, 20, 10, 5, 1]),
];
