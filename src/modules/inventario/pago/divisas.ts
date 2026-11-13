import { BadRequestException } from '@nestjs/common';
import { redondear } from '../../factura/factura-totales';
import type { TipoTasa } from '../../configuracion-pagos/schema/configuracion-pagos.schema';

/** Moneda en la que está expresado todo en el sistema (precios, totales, tasas). */
export const MONEDA_BASE = 'CUP';

/** Las tasas son CUP por 1 unidad de la moneda, así que la tasa del CUP es siempre 1. */
export const TASA_MONEDA_BASE = 1;

/** Cantidad máxima de billetes de una misma denominación en un cobro. */
export const MAX_CANTIDAD_POR_DENOMINACION = 100000;

/** Cantidad máxima de denominaciones distintas en un desglose. */
export const MAX_DENOMINACIONES_DISTINTAS = 50;

/**
 * Tasas con las que se hizo un cobro. Se guarda tal cual en el pago: la tasa
 * del día no permite reconstruir la operación, esta sí. Todas son CUP por 1
 * unidad de la moneda.
 */
export interface TasaUsada {
  tipo: TipoTasa;
  monedaPago: string;
  tasaPago: number;
  /** Solo en efectivo: la moneda en la que se devolvió el cambio. */
  monedaCambio?: string;
  tasaCambio?: number;
  /** Fecha de la tasa más reciente entre las usadas. */
  fecha?: Date;
}

/** Código de moneda en mayúsculas y sin espacios; `undefined` si viene vacío. */
export function aCodigoMoneda(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const codigo = valor.trim().toUpperCase();
  return codigo === '' ? undefined : codigo;
}

/**
 * Moneda de un pago ya guardado. Los pagos anteriores a la Fase 3 no la
 * llevan (o guardaron el id del nomenclador) y siempre fueron en CUP.
 */
export function monedaDelPago(valor: unknown): string {
  const codigo = aCodigoMoneda(valor);

  // Un código tiene de 2 a 10 caracteres; el id de un documento tiene 24.
  return codigo && /^[A-Z0-9]{2,10}$/.test(codigo) ? codigo : MONEDA_BASE;
}

/** Lo que hay que cobrar en `moneda` por un total en CUP (2 decimales). */
export function montoEnMoneda(totalCUP: number, cupPorUnidad: number): number {
  return redondear(totalCUP / cupPorUnidad);
}

/**
 * Cambio expresado en otra moneda: `cambioA × tasaA ÷ tasaB`, con las tasas
 * como CUP por 1 unidad de cada moneda (la del CUP es 1).
 */
export function convertirCambio(
  cambioA: number,
  tasaA: number,
  tasaB: number,
): number {
  return redondear((cambioA * tasaA) / tasaB);
}

const errorDesglose = (mensaje: string, codigo: string): BadRequestException =>
  new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: mensaje,
    codigo,
  });

/** "100", "20.5" o "0.25": un valor con hasta 2 decimales, sin signo ni notación científica. */
const CLAVE_DENOMINACION = /^\d{1,7}(\.\d{1,2})?$/;

export interface DesgloseValidado {
  /** Denominaciones con cantidad > 0, con la clave canónica ("100", no "100.0"). */
  desglose: Record<string, number>;
  /** Suma de valor × cantidad, en la moneda del desglose. */
  total: number;
}

/**
 * Valida el desglose que declara el cajero contra las denominaciones activas
 * de la moneda y lo suma. Rechaza una denominación que no existe para esa
 * moneda (un billete de 200 USD, por ejemplo) y cantidades que no sean enteros.
 */
export function validarDesglose(
  entrada: Record<string, unknown>,
  moneda: string,
  permitidas: readonly number[],
): DesgloseValidado {
  const claves = Object.keys(entrada);

  if (claves.length > MAX_DENOMINACIONES_DISTINTAS) {
    throw errorDesglose(
      `El desglose tiene demasiadas denominaciones (máximo ${MAX_DENOMINACIONES_DISTINTAS})`,
      'DESGLOSE_NO_VALIDO',
    );
  }

  const lista = [...permitidas].sort((a, b) => b - a).join(', ');
  const desglose: Record<string, number> = {};
  let centavos = 0;

  for (const clave of claves) {
    if (!CLAVE_DENOMINACION.test(clave)) {
      throw errorDesglose(
        `La denominación "${clave}" no es válida`,
        'DESGLOSE_NO_VALIDO',
      );
    }

    const valor = Number(clave);
    const permitida = permitidas.some(
      (p) => Math.round(p * 100) === Math.round(valor * 100),
    );

    if (!permitida) {
      throw errorDesglose(
        permitidas.length === 0
          ? `La moneda ${moneda} no tiene billetes ni monedas configurados`
          : `La denominación ${clave} no existe para ${moneda} (las permitidas son: ${lista})`,
        'DENOMINACION_NO_PERMITIDA',
      );
    }

    const cantidad = entrada[clave];

    if (
      typeof cantidad !== 'number' ||
      !Number.isInteger(cantidad) ||
      cantidad < 0 ||
      cantidad > MAX_CANTIDAD_POR_DENOMINACION
    ) {
      throw errorDesglose(
        `La cantidad de billetes de ${clave} ${moneda} debe ser un entero entre 0 y ${MAX_CANTIDAD_POR_DENOMINACION}`,
        'DESGLOSE_NO_VALIDO',
      );
    }

    if (cantidad === 0) continue;

    const canonica = String(valor);
    if (canonica in desglose) {
      throw errorDesglose(
        `La denominación ${canonica} aparece repetida en el desglose`,
        'DESGLOSE_NO_VALIDO',
      );
    }

    desglose[canonica] = cantidad;
    centavos += Math.round(valor * 100) * cantidad;
  }

  return { desglose, total: centavos / 100 };
}
