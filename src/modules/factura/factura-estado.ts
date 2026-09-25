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

/**
 * Every business field `PATCH /facturas/:id` may ever touch (T6b), i.e.
 * the full set editable while `edicion`. Kept as one list so
 * `CAMPOS_EDITABLES_POR_ESTADO[EstadoFactura.EDICION]` and
 * `UpdateFacturaDto`'s own field list can be cross-checked against a
 * single source of truth instead of two independently maintained lists.
 */
export const CAMPOS_FACTURA_EDITABLES = [
  'fecha',
  'cliente',
  'nit',
  'direccion',
  'telefono',
  'email',
  'moneda',
  'concepto',
  'almacenId',
  'impuesto',
  'metodoPago',
  'items',
  'impreso',
  'despachadoPor',
  'transportadoPor',
  'recibidoPor',
  'talonario',
] as const;

/**
 * Which fields `PATCH /facturas/:id` may set while the invoice is in a
 * given state (T6b, "Decisions" in odd/tasks/factura-spec-alignment.md):
 *  - `edicion`: every business field; items/impuesto/almacenId/cliente
 *    changes are re-run server-side (totals, warehouse+products, client
 *    matching), see `FacturaService.construirActualizacion`.
 *  - `terminada`: only `fecha` and `talonario` (spec) plus `impreso` (a
 *    non-fiscal print flag, carried over from every other state so a
 *    closed invoice can still be marked as printed).
 *  - `confirmada`/`cancelada`: only `impreso` — a confirmed or cancelled
 *    invoice is fiscally locked, but can still be (re)printed.
 *  - `anulada`: nothing; a voided invoice is fully read-only.
 */
const CAMPOS_EDITABLES_POR_ESTADO: Record<EstadoFactura, readonly string[]> = {
  [EstadoFactura.EDICION]: CAMPOS_FACTURA_EDITABLES,
  [EstadoFactura.TERMINADA]: ['fecha', 'talonario', 'impreso'],
  [EstadoFactura.CONFIRMADA]: ['impreso'],
  [EstadoFactura.CANCELADA]: ['impreso'],
  [EstadoFactura.ANULADA]: [],
};

/** Field names `PATCH /facturas/:id` may set while `estado` is `estado`. */
export function camposEditablesPorEstado(
  estado: EstadoFactura,
): readonly string[] {
  return CAMPOS_EDITABLES_POR_ESTADO[estado];
}

/**
 * Own-enumerable keys of `dto` whose value is not `undefined` (T6c). With
 * `tsconfig.json`'s `target: ES2023`, `useDefineForClassFields` defaults to
 * `true`, so every declared class field of a `class-transformer`
 * `plainToInstance`d DTO (e.g. `UpdateFacturaDto`) becomes an own property
 * at construction time, even when the caller never sent it — its value is
 * simply `undefined`. Own keys are therefore NOT the same thing as "fields
 * the caller actually sent"; this helper is the single source of truth for
 * that distinction, used everywhere update reasons about "sent fields"
 * (`camposNoPermitidos`, `FacturaService.update`'s empty-body check and
 * `$set` builder).
 */
export function camposPresentes(dto: object): string[] {
  const registro = dto as Record<string, unknown>;
  return Object.keys(dto).filter((campo) => registro[campo] !== undefined);
}

/**
 * Fields of `dto` that are actually present (`camposPresentes`) and not
 * editable while the invoice is in `estado` (used by `FacturaService.update`
 * to build the 409).
 */
export function camposNoPermitidos(
  estado: EstadoFactura,
  dto: object,
): string[] {
  const permitidos = new Set(camposEditablesPorEstado(estado));
  return camposPresentes(dto).filter((campo) => !permitidos.has(campo));
}

/**
 * Clear Spanish 409 message naming the invoice, its current state and
 * every field the caller tried to change that state does not allow.
 */
export function mensajeCamposNoPermitidos(
  id: string,
  estado: EstadoFactura,
  campos: string[],
): string {
  return `La factura ${id} esta en estado "${estado}": no se puede modificar ${campos.join(', ')}`;
}
