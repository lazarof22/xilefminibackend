import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  EMPRESA_ID_MAX_LENGTH,
  FIRMA_REGEX,
  FIRMA_VERSION,
  HARDWARE_FINGERPRINT_REGEX,
  LICENCIA_TIPOS,
  LICENSE_ID_REGEX,
} from '../services/payload-builder';
import type { LicenciaTipo } from '../services/payload-builder';

/** `fecha_vencimiento` is `null` if and only if `tipo === 'perpetua'`. */
@ValidatorConstraint({ name: 'vencimientoCoherente' })
export class VencimientoCoherente implements ValidatorConstraintInterface {
  validate(_tipo: unknown, args: ValidationArguments): boolean {
    const o = args.object as Partial<LicenciaPayloadDto>;
    return (o.tipo === 'perpetua') === (o.fecha_vencimiento === null);
  }

  defaultMessage(): string {
    return 'fecha_vencimiento must be null if and only if tipo is "perpetua"';
  }
}

/**
 * Signed payload v3, validated strictly. Unknown keys are rejected by the
 * global `forbidNonWhitelisted` pipe of the controller. The crypto service
 * re-validates the exact key set before verifying the signature.
 */
export class LicenciaPayloadDto {
  @ApiProperty()
  @IsBoolean()
  activa: boolean;

  @ApiProperty({ example: '2026-01-01T12:00:00.000Z' })
  @IsString()
  @IsISO8601({ strict: true })
  emitida_en: string;

  @ApiProperty({ maxLength: EMPRESA_ID_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMPRESA_ID_MAX_LENGTH)
  empresa_id: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsString()
  @IsISO8601({ strict: true })
  fecha_inicio: string;

  @ApiProperty({
    nullable: true,
    description: 'null if and only if tipo === "perpetua"',
  })
  @ValidateIf((o: LicenciaPayloadDto) => o.fecha_vencimiento !== null)
  @IsString()
  @IsISO8601({ strict: true })
  fecha_vencimiento: string | null;

  @ApiProperty({ description: 'sha256 hex (64 lowercase chars)' })
  @IsString()
  @Matches(HARDWARE_FINGERPRINT_REGEX)
  hardware_fingerprint: string;

  @ApiProperty({ description: 'lowercase uuid' })
  @IsString()
  @Matches(LICENSE_ID_REGEX)
  license_id: string;

  @ApiProperty({ description: '0 = unlimited' })
  @IsInt()
  @Min(0)
  max_usuarios: number;

  @ApiProperty()
  @IsBoolean()
  revocada: boolean;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  secuencia: number;

  @ApiProperty({ enum: LICENCIA_TIPOS })
  @IsIn(LICENCIA_TIPOS)
  @Validate(VencimientoCoherente)
  tipo: LicenciaTipo;
}

/** Body of `POST /licencia/activar`: the `.lic` artifact as produced by the signer. */
export class ActivarLicenciaDto {
  @ApiProperty({ example: 3, description: 'Only 3 is accepted' })
  @IsIn([FIRMA_VERSION])
  version_firma: number;

  @ApiProperty({ type: LicenciaPayloadDto })
  @IsObject()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => LicenciaPayloadDto)
  payload: LicenciaPayloadDto;

  @ApiProperty({ description: 'Ed25519 signature, 128 lowercase hex chars' })
  @IsString()
  @Matches(FIRMA_REGEX)
  firma: string;
}
