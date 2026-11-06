import { ForbiddenException } from '@nestjs/common';
import { UsuarioRol } from '../../../auth/schemas/usuarios.schema';

/**
 * Descuento máximo (en %) que cada rol puede poner a una línea en el punto de
 * venta. El servidor lo valida; la pantalla solo lo usa para no ofrecer más.
 *
 * Hoy TODOS los roles pueden hasta 100 %, que es lo que el punto de venta
 * permitía antes: el documento pide validar el descuento por rol, pero no fija
 * los topes y no conviene inventarlos. Para limitar a un rol, basta con bajar
 * su número aquí (por ejemplo `[UsuarioRol.CAJERO]: 10`).
 */
export const DESCUENTO_MAXIMO_POR_ROL: Readonly<Record<string, number>> = {
  [UsuarioRol.ADMIN]: 100,
  [UsuarioRol.GERENTE]: 100,
  [UsuarioRol.JEFE]: 100,
  [UsuarioRol.ECONOMICO]: 100,
  [UsuarioRol.FACTURADOR]: 100,
  [UsuarioRol.CAJERO]: 100,
  [UsuarioRol.EMPLEADO]: 100,
};

/** Tope para un rol que no esté en la tabla. */
export const DESCUENTO_MAXIMO_POR_DEFECTO = 100;

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
