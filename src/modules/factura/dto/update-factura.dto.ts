import { PartialType, PickType } from '@nestjs/swagger';
import { CreateFacturaDto } from './create-factura.dto';

/**
 * Only non-fiscal, non-correlative fields may be edited after emission.
 * Items, totals, tax, numero, estado, fecha and nit are intentionally
 * excluded: changing them after emission would falsify an already
 * numbered invoice (see FacturaService.update / anular).
 */
export class UpdateFacturaDto extends PartialType(
  PickType(CreateFacturaDto, [
    'concepto',
    'impreso',
    'direccion',
    'telefono',
    'email',
  ] as const),
) {}
