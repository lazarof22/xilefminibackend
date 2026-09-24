import { EstadoFactura } from './factura.constants';
import {
  esTransicionValida,
  mensajeTransicionInvalida,
  origenesPermitidos,
} from './factura-estado';

const TODOS_LOS_ESTADOS = Object.values(EstadoFactura);

/**
 * Legal transitions per the "Decisions" section of
 * odd/tasks/factura-spec-alignment.md:
 *   edicion    -> terminada | anulada
 *   terminada  -> edicion | confirmada | anulada
 *   confirmada -> cancelada
 *   cancelada  -> (terminal)
 *   anulada    -> (terminal)
 */
const TRANSICIONES_ESPERADAS: Record<EstadoFactura, EstadoFactura[]> = {
  [EstadoFactura.EDICION]: [EstadoFactura.TERMINADA, EstadoFactura.ANULADA],
  [EstadoFactura.TERMINADA]: [
    EstadoFactura.EDICION,
    EstadoFactura.CONFIRMADA,
    EstadoFactura.ANULADA,
  ],
  [EstadoFactura.CONFIRMADA]: [EstadoFactura.CANCELADA],
  [EstadoFactura.CANCELADA]: [],
  [EstadoFactura.ANULADA]: [],
};

describe('factura-estado (T6a)', () => {
  describe('esTransicionValida — exhaustive over all 25 origen/destino pairs', () => {
    for (const origen of TODOS_LOS_ESTADOS) {
      for (const destino of TODOS_LOS_ESTADOS) {
        const esperado = TRANSICIONES_ESPERADAS[origen].includes(destino);
        it(`${origen} -> ${destino} is ${esperado ? 'allowed' : 'rejected'}`, () => {
          expect(esTransicionValida(origen, destino)).toBe(esperado);
        });
      }
    }
  });

  describe('origenesPermitidos — states that may reach each destino in one step', () => {
    it('edicion is reachable only from terminada', () => {
      expect(origenesPermitidos(EstadoFactura.EDICION)).toEqual([
        EstadoFactura.TERMINADA,
      ]);
    });

    it('terminada is reachable only from edicion', () => {
      expect(origenesPermitidos(EstadoFactura.TERMINADA)).toEqual([
        EstadoFactura.EDICION,
      ]);
    });

    it('confirmada is reachable only from terminada', () => {
      expect(origenesPermitidos(EstadoFactura.CONFIRMADA)).toEqual([
        EstadoFactura.TERMINADA,
      ]);
    });

    it('cancelada is reachable only from confirmada', () => {
      expect(origenesPermitidos(EstadoFactura.CANCELADA)).toEqual([
        EstadoFactura.CONFIRMADA,
      ]);
    });

    it('anulada is reachable from edicion or terminada', () => {
      expect(origenesPermitidos(EstadoFactura.ANULADA)).toEqual([
        EstadoFactura.EDICION,
        EstadoFactura.TERMINADA,
      ]);
    });
  });

  describe('mensajeTransicionInvalida', () => {
    it('names the invoice id, its current state and the attempted transition', () => {
      const mensaje = mensajeTransicionInvalida(
        'FAC-000005',
        EstadoFactura.CANCELADA,
        EstadoFactura.TERMINADA,
      );

      expect(mensaje).toContain('FAC-000005');
      expect(mensaje).toContain(EstadoFactura.CANCELADA);
      expect(mensaje).toContain(EstadoFactura.TERMINADA);
    });
  });
});
