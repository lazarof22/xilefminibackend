import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Bounds of the mandatory annulment reason (doc 6.3 / 7.2). */
export const MOTIVO_ANULACION_MIN = 5;
export const MOTIVO_ANULACION_MAX = 300;

/**
 * Reason for voiding/cancelling an invoice. Sent in the body of
 * `PATCH /facturas/:id/anular` and `PATCH /facturas/:id/cancelar`, and as the
 * `?motivo=` query param of `DELETE /facturas/:id`.
 */
export class AnularFacturaDto {
  @ApiProperty({
    description: `Motivo de la anulación (obligatorio, ${MOTIVO_ANULACION_MIN} a ${MOTIVO_ANULACION_MAX} caracteres)`,
    minLength: MOTIVO_ANULACION_MIN,
    maxLength: MOTIVO_ANULACION_MAX,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'El motivo de la anulación es obligatorio' })
  @IsNotEmpty({ message: 'El motivo de la anulación es obligatorio' })
  @MinLength(MOTIVO_ANULACION_MIN, {
    message: `El motivo de la anulación debe tener al menos ${MOTIVO_ANULACION_MIN} caracteres`,
  })
  @MaxLength(MOTIVO_ANULACION_MAX, {
    message: `El motivo de la anulación no puede superar ${MOTIVO_ANULACION_MAX} caracteres`,
  })
  motivo!: string;
}
