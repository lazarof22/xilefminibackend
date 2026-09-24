import { EstadoFactura } from './factura.constants';

/**
 * Pure invoice state machine (T6a, "Decisions" in
 * odd/tasks/factura-spec-alignment.md):
 *
 *   edicion    -> terminada | anulada
 *   terminada  -> edicion | confirmada | anulada
 *   confirmada -> cancelada
 *   cancelada  -> (terminal)
 *   anulada    -> (terminal)
 *
 * `confirmada`/`cancelada` carry inventory side effects (T7, not here):
 * confirmar decreases stock, cancelar rolls a confirmed invoice back and
 * increases it. This module only knows which single-step transitions are
 * legal; it never touches Mongo, inventory or any other side effect —
 * `FacturaService.transicionar` uses it to build the atomic conditional
 * filter for the state change.
 */
const TRANSICIONES: Record<EstadoFactura, EstadoFactura[]> = {
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

/** Whether `origen -> destino` is one legal step in the state machine. */
export function esTransicionValida(
  origen: EstadoFactura,
  destino: EstadoFactura,
): boolean {
  return TRANSICIONES[origen].includes(destino);
}

/**
 * States a factura may currently be in for `destino` to be reachable in
 * one step. Used to build the atomic `findOneAndUpdate` filter
 * (`estado: { $in: origenesPermitidos(destino) } }`) so claiming the
 * transition and checking the current state happen in a single
 * conditional write, with no read-then-write race.
 */
export function origenesPermitidos(destino: EstadoFactura): EstadoFactura[] {
  return (Object.keys(TRANSICIONES) as EstadoFactura[]).filter((origen) =>
    TRANSICIONES[origen].includes(destino),
  );
}

/**
 * Clear Spanish 409 message naming the invoice, its current state and the
 * attempted transition, for when a conditional transition update matches
 * no document because the invoice is not in an allowed origin state.
 */
export function mensajeTransicionInvalida(
  id: string,
  actual: EstadoFactura,
  destino: EstadoFactura,
): string {
  return `La factura ${id} esta en estado "${actual}" y no puede pasar a "${destino}"`;
}
