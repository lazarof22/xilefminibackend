import { PartialType, PickType } from '@nestjs/swagger';
import { CreateFacturaDto } from './create-factura.dto';

/**
 * Only non-fiscal, non-correlative fields may be edited after emission.
 * Items, totals, tax, numero, estado, fecha and nit are intentionally
 * excluded: changing them after emission would falsify an already
 * numbered invoice (see FacturaService.update / anular).
 *
 * `despachadoPor`/`transportadoPor`/`recibidoPor` (T3) are editable here
 * too: they're free document data (not fiscal fields), typically filled
 * in after the invoice already exists. Per-invoice-state edit
 * restrictions (e.g. only while `edicion`) are out of scope for T3 and
 * land with the state machine (T6).
 */
export class UpdateFacturaDto extends PartialType(
  PickType(CreateFacturaDto, [
    'concepto',
    'impreso',
    'direccion',
    'telefono',
    'email',
    'despachadoPor',
    'transportadoPor',
    'recibidoPor',
  ] as const),
) {}
