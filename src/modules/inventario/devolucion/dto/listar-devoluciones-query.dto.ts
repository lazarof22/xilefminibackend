import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  DevolucionTipo,
  EstadoDevolucion,
  FormaDevolucionDinero,
} from '../schema/devolucion.schema';

export const DEVOLUCION_LIMITE_DEFECTO = 50;
export const DEVOLUCION_LIMITE_MAXIMO = 500;

export class ListarDevolucionesQueryDto {
  @ApiPropertyOptional({
    enum: FormaDevolucionDinero,
    description: 'Para el cuadre de caja: efectivo devuelto',
  })
  @IsOptional()
  @IsEnum(FormaDevolucionDinero)
  formaDevolucionDinero?: FormaDevolucionDinero;

  @ApiPropertyOptional({ enum: DevolucionTipo })
  @IsOptional()
  @IsEnum(DevolucionTipo)
  tipo?: DevolucionTipo;

  @ApiPropertyOptional({
    description: 'Devoluciones de un documento de origen',
  })
  @IsOptional()
  @IsMongoId()
  origenRef?: string;

  @ApiPropertyOptional({
    enum: EstadoDevolucion,
    description:
      'Por defecto solo `registrada` (las que sí movieron stock y dinero)',
  })
  @IsOptional()
  @IsEnum(EstadoDevolucion)
  estado?: EstadoDevolucion;

  @ApiPropertyOptional({
    description:
      'Desde (inclusive). ISO 8601; una fecha sola cuenta desde 00:00 UTC',
    example: '2026-11-01',
  })
  @IsOptional()
  @IsDateString()
  desde?: string;

  @ApiPropertyOptional({
    description:
      'Hasta (inclusive). Una fecha sola incluye todo ese día (UTC); con hora, hasta ese instante',
    example: '2026-11-03',
  })
  @IsOptional()
  @IsDateString()
  hasta?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: DEVOLUCION_LIMITE_MAXIMO,
    default: DEVOLUCION_LIMITE_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DEVOLUCION_LIMITE_MAXIMO)
  limite?: number;
}
