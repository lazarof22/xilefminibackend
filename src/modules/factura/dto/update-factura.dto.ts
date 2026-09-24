import { ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CreateFacturaDto, ParticipanteFacturaDto } from './create-factura.dto';

/**
 * Every business field `CreateFacturaDto` accepts, minus `tipo` (spec:
 * "TABLA DE UNA FACTURA" never lists the invoice type as editable). Which
 * of these a given PATCH may actually set depends on the invoice's current
 * `estado` (T6b, `factura-estado.ts` — `camposEditablesPorEstado`,
 * `FacturaService.update`): `edicion` accepts every one of them (with
 * items/impuesto/almacenId/cliente changes re-validated and recomputed
 * server-side, mirroring `create`); `terminada` only `fecha`/`talonario`/
 * `impreso`; `confirmada`/`cancelada` only `impreso`; `anulada` nothing.
 * Server-controlled fields (`id`, `numero`, `estado`, totals, `emisor`,
 * `facturadoPor`, `almacenCodigo`, `clienteId`) are never listed here, so
 * the global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`)
 * rejects any request that still sends them.
 */
export class UpdateFacturaDto extends PartialType(
  PickType(CreateFacturaDto, [
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
  ] as const),
) {
  // Redeclared instead of inherited: `PartialType` adds its own
  // `@IsOptional()` to every picked property, which (unlike `@ValidateIf`)
  // also skips validation for `null` — silently letting a PATCH erase a
  // participant or the talonario. Redeclaring with the same `@ValidateIf`
  // stack as `CreateFacturaDto` keeps `null` rejected here too (same
  // pattern as `UpdateAlmacenDto.codigo`, T2b).
  @ApiPropertyOptional({
    type: ParticipanteFacturaDto,
    description: 'Despachado por',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => ParticipanteFacturaDto)
  despachadoPor?: ParticipanteFacturaDto;

  @ApiPropertyOptional({
    type: ParticipanteFacturaDto,
    description: 'Transportado por',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => ParticipanteFacturaDto)
  transportadoPor?: ParticipanteFacturaDto;

  @ApiPropertyOptional({
    type: ParticipanteFacturaDto,
    description: 'Recibido por',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => ParticipanteFacturaDto)
  recibidoPor?: ParticipanteFacturaDto;

  @ApiPropertyOptional({
    description: 'Numero de talonario / recibo asociado a la factura',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  talonario?: string;
}
