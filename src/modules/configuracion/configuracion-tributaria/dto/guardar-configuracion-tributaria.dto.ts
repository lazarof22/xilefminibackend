import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BonificacionTributariaDto {
  @ApiProperty({ example: 'MIPYME', description: 'Programa que otorga la bonificación' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  programa!: string;

  @ApiPropertyOptional({ example: 'Agropecuario' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sector?: string;

  @ApiProperty({
    example: 5,
    minimum: 0,
    maximum: 100,
    description: 'Porcentaje del impuesto sobre ventas aplicado con la bonificación',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  impuestoVentasPct!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class GuardarConfiguracionTributariaDto {
  @ApiProperty({ example: 10, minimum: 0, maximum: 100, description: 'Impuesto sobre ventas (%)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  impuestoVentasPct!: number;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Fecha desde la que rige. Por defecto, hoy.',
  })
  @IsOptional()
  @IsDateString()
  vigenteDesde?: string;

  @ApiPropertyOptional({ type: [BonificacionTributariaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BonificacionTributariaDto)
  bonificaciones?: BonificacionTributariaDto[];
}
