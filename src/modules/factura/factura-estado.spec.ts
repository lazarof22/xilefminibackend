import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { EstadoFactura } from './factura.constants';
import {
  CAMPOS_FACTURA_EDITABLES,
  camposEditablesPorEstado,
  camposNoPermitidos,
  camposPresentes,
  esTransicionValida,
  mensajeCamposNoPermitidos,
  mensajeTransicionInvalida,
  origenesPermitidos,
} from './factura-estado';
import { UpdateFacturaDto } from './dto/update-factura.dto';

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

  describe('camposEditablesPorEstado (T6b)', () => {
    it('edicion allows every business field', () => {
      expect(camposEditablesPorEstado(EstadoFactura.EDICION)).toEqual(
        CAMPOS_FACTURA_EDITABLES,
      );
    });

    it('terminada allows only fecha, talonario and impreso', () => {
      expect(camposEditablesPorEstado(EstadoFactura.TERMINADA)).toEqual([
        'fecha',
        'talonario',
        'impreso',
      ]);
    });

    it('confirmada allows only impreso', () => {
      expect(camposEditablesPorEstado(EstadoFactura.CONFIRMADA)).toEqual([
        'impreso',
      ]);
    });

    it('cancelada allows only impreso', () => {
      expect(camposEditablesPorEstado(EstadoFactura.CANCELADA)).toEqual([
        'impreso',
      ]);
    });

    it('anulada allows nothing', () => {
      expect(camposEditablesPorEstado(EstadoFactura.ANULADA)).toEqual([]);
    });
  });

  describe('camposNoPermitidos (T6b)', () => {
    it('returns an empty array when every sent field is allowed', () => {
      expect(
        camposNoPermitidos(EstadoFactura.TERMINADA, {
          fecha: '2026-09-24',
          talonario: 'T-001',
        }),
      ).toEqual([]);
    });

    it('names every rejected field for terminada', () => {
      expect(
        camposNoPermitidos(EstadoFactura.TERMINADA, {
          concepto: 'x',
          items: [],
          fecha: '2026-09-24',
        }),
      ).toEqual(['concepto', 'items']);
    });

    it('rejects every field for anulada', () => {
      expect(
        camposNoPermitidos(EstadoFactura.ANULADA, { impreso: true }),
      ).toEqual(['impreso']);
    });

    it('returns an empty array for an empty dto', () => {
      expect(camposNoPermitidos(EstadoFactura.EDICION, {})).toEqual([]);
    });
  });

  describe('camposPresentes (T6c)', () => {
    it('returns only own keys whose value is not undefined', () => {
      expect(
        camposPresentes({ fecha: '2026-09-24', talonario: undefined }),
      ).toEqual(['fecha']);
    });

    it('returns an empty array when every own key is undefined', () => {
      expect(
        camposPresentes({ fecha: undefined, talonario: undefined }),
      ).toEqual([]);
    });

    it('returns an empty array for an object with no own keys', () => {
      expect(camposPresentes({})).toEqual([]);
    });

    /**
     * Regression (T6c, confirmed by the parent on the built app): with
     * `tsconfig.json`'s `target: ES2023`, `useDefineForClassFields`
     * defaults to `true`, so `plainToInstance(UpdateFacturaDto, { fecha })`
     * gives every OTHER declared field of `UpdateFacturaDto` an own key
     * with value `undefined` (`despachadoPor`, `transportadoPor`,
     * `recibidoPor`, `talonario`, etc.) — `Object.keys()` on that instance
     * is NOT the set of fields the caller actually sent. Before this fix,
     * `camposNoPermitidos` used `Object.keys()` directly and rejected
     * those undefined-valued fields for `terminada`, so a bare `{ fecha }`
     * PATCH on a `terminada` invoice returned 409 in production even
     * though `fecha` alone is allowed. Building the DTO with the real
     * `plainToInstance` (not a plain object) is what makes this fail on
     * the pre-fix code — a plain object never has those extra own keys.
     */
    it('reproduces the terminada + { fecha } production bug: a real plainToInstance DTO has undefined-valued own keys that are not "sent"', () => {
      const dto = plainToInstance(UpdateFacturaDto, { fecha: '2026-09-24' });

      expect(Object.keys(dto)).toEqual(
        expect.arrayContaining([
          'despachadoPor',
          'transportadoPor',
          'recibidoPor',
          'talonario',
        ]),
      );
      expect(camposPresentes(dto)).toEqual(['fecha']);
    });
  });

  describe('camposNoPermitidos with a real plainToInstance DTO (T6c regression)', () => {
    it('terminada + { fecha } via plainToInstance(UpdateFacturaDto) rejects nothing', () => {
      const dto = plainToInstance(UpdateFacturaDto, { fecha: '2026-09-24' });

      expect(camposNoPermitidos(EstadoFactura.TERMINADA, dto)).toEqual([]);
    });

    it('edicion + a full plainToInstance DTO with every field sent rejects nothing', () => {
      const dto = plainToInstance(UpdateFacturaDto, {
        fecha: '2026-09-24',
        concepto: 'x',
        talonario: 'T-001',
      });

      expect(camposNoPermitidos(EstadoFactura.EDICION, dto)).toEqual([]);
    });
  });

  describe('mensajeCamposNoPermitidos', () => {
    it('names the invoice id, its state and the rejected fields', () => {
      const mensaje = mensajeCamposNoPermitidos(
        'FAC-000005',
        EstadoFactura.TERMINADA,
        ['concepto', 'items'],
      );

      expect(mensaje).toContain('FAC-000005');
      expect(mensaje).toContain(EstadoFactura.TERMINADA);
      expect(mensaje).toContain('concepto');
      expect(mensaje).toContain('items');
    });
  });
});
