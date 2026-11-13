import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  TIPOS_DENOMINACION,
  type TipoDenominacion,
} from '../schema/denominacion-moneda.schema';

const aCodigo = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateDenominacionMonedaDto {
  /** Código de la moneda tal como está en el nomenclador Moneda (CUP, USD, EUR...). */
  @Transform(aCodigo)
  @IsString()
  @Matches(/^[A-Z0-9]{2,10}$/, {
    message: 'El código de moneda debe tener de 2 a 10 letras o números',
  })
  moneda!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  valor!: number;

  @IsOptional()
  @IsIn(TIPOS_DENOMINACION)
  tipo?: TipoDenominacion;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
