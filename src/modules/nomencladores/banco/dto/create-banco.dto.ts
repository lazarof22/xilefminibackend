import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { normalizarPatron, PATRON_PREFIJO } from '../prefijo-tarjeta';

const aCodigo = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const aPatrones = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((v) =>
        typeof v === 'string' ? normalizarPatron(v) : v,
      )
    : value;

export class CreateBancoDto {
  /** Código corto único: BPA, BANDEC, BM... */
  @Transform(aCodigo)
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,20}$/, {
    message:
      'El código del banco debe tener de 2 a 20 letras, números, guiones o guion bajo',
  })
  codigo!: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre!: string;

  /**
   * Con qué dígitos empieza el número de las tarjetas del banco. Dígitos y `?`
   * (cualquier dígito): `92250699` o `????0699` (segundo grupo de 4 dígitos).
   */
  @IsOptional()
  @Transform(aPatrones)
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(PATRON_PREFIJO, {
    each: true,
    message:
      'Cada prefijo de tarjeta debe tener de 1 a 19 caracteres: dígitos o ? (cualquier dígito)',
  })
  prefijosTarjeta?: string[];

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
