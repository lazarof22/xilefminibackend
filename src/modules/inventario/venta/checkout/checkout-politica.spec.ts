import { ForbiddenException } from '@nestjs/common';
import { UsuarioRol } from '../../../auth/schemas/usuarios.schema';
import {
  DESCUENTO_MAXIMO_POR_DEFECTO,
  DESCUENTO_MAXIMO_POR_ROL,
  descuentoEfectivoPct,
  descuentoMaximoPara,
  validarDescuentos,
} from './checkout-politica';

/**
 * Design document §6.9: only the administrator and the manager may apply a
 * manual discount; every other role is capped at 0 %.
 */
describe('checkout-politica', () => {
  describe('tabla de topes por rol', () => {
    it('administrador y gerente pueden hasta 100 %', () => {
      expect(descuentoMaximoPara(UsuarioRol.ADMIN)).toBe(100);
      expect(descuentoMaximoPara(UsuarioRol.GERENTE)).toBe(100);
    });

    it.each([
      UsuarioRol.JEFE,
      UsuarioRol.ECONOMICO,
      UsuarioRol.FACTURADOR,
      UsuarioRol.CAJERO,
      UsuarioRol.EMPLEADO,
    ])('el rol %s no puede dar descuento manual (0 %)', (rol) => {
      expect(DESCUENTO_MAXIMO_POR_ROL[rol]).toBe(0);
      expect(descuentoMaximoPara(rol)).toBe(0);
    });

    it('un rol desconocido recibe el tope por defecto (0 %)', () => {
      expect(DESCUENTO_MAXIMO_POR_DEFECTO).toBe(0);
      expect(descuentoMaximoPara('inventado')).toBe(0);
    });

    it('acepta una tabla alternativa', () => {
      expect(descuentoMaximoPara('cajero', { cajero: 15 })).toBe(15);
    });
  });

  describe('validarDescuentos', () => {
    it('un cajero con 0 % que pide 10 % recibe 403 con el tope en el mensaje', () => {
      expect(() => validarDescuentos([0, 10], UsuarioRol.CAJERO)).toThrow(
        ForbiddenException,
      );
      expect(() => validarDescuentos([0, 10], UsuarioRol.CAJERO)).toThrow(
        /hasta 0% de descuento por línea \(se pidió 10%\)/,
      );
    });

    it('un cajero con 0 % pasa si todas las líneas van sin descuento', () => {
      expect(() => validarDescuentos([0, 0], UsuarioRol.CAJERO)).not.toThrow();
      expect(() => validarDescuentos([], UsuarioRol.CAJERO)).not.toThrow();
    });

    it('el administrador y el gerente pueden hasta 100 %', () => {
      expect(() => validarDescuentos([100, 50], UsuarioRol.ADMIN)).not.toThrow();
      expect(() => validarDescuentos([100], UsuarioRol.GERENTE)).not.toThrow();
    });
  });

  describe('descuentoEfectivoPct', () => {
    it('sin descuento de cliente es el manual', () => {
      expect(descuentoEfectivoPct(15)).toBe(15);
      expect(descuentoEfectivoPct(15, 0)).toBe(15);
    });

    it('con descuento de cliente es el mayor de los dos', () => {
      expect(descuentoEfectivoPct(0, 10)).toBe(10);
      expect(descuentoEfectivoPct(5, 10)).toBe(10);
      expect(descuentoEfectivoPct(30, 10)).toBe(30);
    });
  });
});
