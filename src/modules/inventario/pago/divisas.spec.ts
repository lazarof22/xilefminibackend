import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  aCodigoMoneda,
  convertirCambio,
  monedaDelPago,
  montoEnMoneda,
  validarDesglose,
} from './divisas';

const USD = [100, 50, 20, 10, 5, 1];

function mensajeDe(fn: () => unknown): { message: string; codigo?: string } {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as {
      message: string;
      codigo?: string;
    };
  }
  throw new Error('Se esperaba un error 400');
}

describe('divisas', () => {
  describe('aCodigoMoneda / monedaDelPago', () => {
    it('normaliza el código a mayúsculas y sin espacios', () => {
      expect(aCodigoMoneda(' usd ')).toBe('USD');
      expect(aCodigoMoneda('')).toBeUndefined();
      expect(aCodigoMoneda('   ')).toBeUndefined();
      expect(aCodigoMoneda(undefined)).toBeUndefined();
      expect(aCodigoMoneda(5)).toBeUndefined();
    });

    it('un pago anterior a la Fase 3 (sin moneda o con el id del nomenclador) era en CUP', () => {
      expect(monedaDelPago(undefined)).toBe('CUP');
      expect(monedaDelPago(null)).toBe('CUP');
      expect(monedaDelPago(new Types.ObjectId())).toBe('CUP');
      expect(monedaDelPago(new Types.ObjectId().toHexString())).toBe('CUP');
      expect(monedaDelPago('usd')).toBe('USD');
      expect(monedaDelPago('EUR')).toBe('EUR');
    });
  });

  describe('conversión', () => {
    it('lo que se cobra en la moneda: total ÷ tasa, a 2 decimales', () => {
      expect(montoEnMoneda(4000, 400)).toBe(10);
      expect(montoEnMoneda(1001, 400)).toBe(2.5);
      expect(montoEnMoneda(4000, 120)).toBe(33.33);
      expect(montoEnMoneda(385, 1)).toBe(385);
    });

    it('cambioConvertido = cambioA × tasaA ÷ tasaB', () => {
      // 10 USD a 400 CUP por USD → 4000 CUP.
      expect(convertirCambio(10, 400, 1)).toBe(4000);
      // 5 EUR a 450 → USD a 400: 5.625 → 5.63.
      expect(convertirCambio(5, 450, 400)).toBe(5.63);
      // 1000 CUP → USD a 400: 2.50.
      expect(convertirCambio(1000, 1, 400)).toBe(2.5);
      expect(convertirCambio(0, 400, 1)).toBe(0);
    });
  });

  describe('validarDesglose', () => {
    it('suma valor × cantidad y devuelve las claves canónicas, sin cantidades en cero', () => {
      const r = validarDesglose(
        { '100': 2, '20.0': 0, '5': 3, '1': 1 },
        'USD',
        USD,
      );

      expect(r).toEqual({ desglose: { '100': 2, '5': 3, '1': 1 }, total: 216 });
    });

    it('con decimales no acumula errores de coma flotante', () => {
      const r = validarDesglose({ '0.1': 3, '0.2': 1 }, 'XXX', [0.1, 0.2]);

      expect(r.total).toBe(0.5);
    });

    it('rechaza una denominación que no existe para la moneda y lista las permitidas', () => {
      const e = mensajeDe(() => validarDesglose({ '200': 1 }, 'USD', USD));

      expect(e.codigo).toBe('DENOMINACION_NO_PERMITIDA');
      expect(e.message).toBe(
        'La denominación 200 no existe para USD (las permitidas son: 100, 50, 20, 10, 5, 1)',
      );
    });

    it('una moneda sin billetes configurados lo dice', () => {
      const e = mensajeDe(() => validarDesglose({ '5': 1 }, 'EUR', []));

      expect(e.message).toMatch(
        /EUR no tiene billetes ni monedas configurados/,
      );
    });

    it('claves que no son un valor (letras, negativos, notación científica, demasiados decimales) → 400', () => {
      for (const clave of ['abc', '-5', '1e2', '5.005', '', ' 5']) {
        const e = mensajeDe(() => validarDesglose({ [clave]: 1 }, 'USD', USD));
        expect(e.codigo).toBe('DESGLOSE_NO_VALIDO');
      }
    });

    it('cantidades que no son enteros de 0 a 100000 → 400', () => {
      for (const cantidad of [1.5, -1, 100001, '2', null, Number.NaN]) {
        const e = mensajeDe(() =>
          validarDesglose({ '5': cantidad }, 'USD', USD),
        );
        expect(e.codigo).toBe('DESGLOSE_NO_VALIDO');
      }
    });

    it('la misma denominación escrita de dos formas es un desglose repetido', () => {
      const e = mensajeDe(() =>
        validarDesglose({ '100': 1, '100.0': 1 }, 'USD', USD),
      );

      expect(e.message).toMatch(/aparece repetida/);
    });

    it('limita las denominaciones distintas', () => {
      const muchas = Object.fromEntries(
        Array.from({ length: 51 }, (_, i) => [String(i + 1), 1]),
      );
      const e = mensajeDe(() =>
        validarDesglose(
          muchas,
          'USD',
          Array.from({ length: 60 }, (_, i) => i + 1),
        ),
      );

      expect(e.message).toMatch(/demasiadas denominaciones/);
    });

    it('un desglose vacío suma 0', () => {
      expect(validarDesglose({}, 'USD', USD)).toEqual({
        desglose: {},
        total: 0,
      });
    });
  });
});
