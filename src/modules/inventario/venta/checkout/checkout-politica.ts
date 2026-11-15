import { ForbiddenException } from '@nestjs/common';
import { UsuarioRol } from '../../../auth/schemas/usuarios.schema';

/**
 * Descuento MANUAL máximo (en %) que cada rol puede poner a una línea en el
 * punto de venta. El servidor lo valida; la pantalla solo lo usa para no
 * ofrecer más.
 *
 * Documento de diseño §6.9 ("Descuento manual / cambio de precio:
 * Administrador, Gerente") y §7.1: solo el administrador y el gerente pueden
 * descontar a mano (hasta 100 %); el resto de los roles, 0 %.
 *
 * El tope solo limita lo que el cajero escribe a mano. El descuento de un
 * cliente con descuento (§6.8) es automático y no pasa por este tope. Para dar
 * un margen a un rol, basta con subir su número aquí (por ejemplo
 * `[UsuarioRol.JEFE]: 10`).
 */
export const DESCUENTO_MAXIMO_POR_ROL: Readonly<Record<string, number>> = {
  [UsuarioRol.ADMIN]: 100,
  [UsuarioRol.GERENTE]: 100,
  [UsuarioRol.JEFE]: 0,
  [UsuarioRol.ECONOMICO]: 0,
  [UsuarioRol.FACTURADOR]: 0,
  [UsuarioRol.CAJERO]: 0,
  [UsuarioRol.EMPLEADO]: 0,
};

/** Tope para un rol que no esté en la tabla: sin descuento manual. */
export const DESCUENTO_MAXIMO_POR_DEFECTO = 0;

/**
 * Descuento que realmente se aplica a una línea: el mayor entre el manual y el
 * del cliente con descuento (no se acumulan).
 */
export function descuentoEfectivoPct(
  manualPct: number,
  descuentoClientePct = 0,
): number {
  return Math.max(manualPct, descuentoClientePct);
}

export function descuentoMaximoPara(
  rol: string,
  tabla: Readonly<Record<string, number>> = DESCUENTO_MAXIMO_POR_ROL,
): number {
  return tabla[rol] ?? DESCUENTO_MAXIMO_POR_DEFECTO;
}

/** Rechaza (403) si alguna línea supera el descuento permitido al rol. */
export function validarDescuentos(
  descuentosPct: number[],
  rol: string,
  tabla: Readonly<Record<string, number>> = DESCUENTO_MAXIMO_POR_ROL,
): void {
  const maximo = descuentoMaximoPara(rol, tabla);
  const exceso = descuentosPct.find((d) => d > maximo);

  if (exceso !== undefined) {
    throw new ForbiddenException(
      `El rol ${rol} puede aplicar hasta ${maximo}% de descuento por línea (se pidió ${exceso}%)`,
    );
  }
}
