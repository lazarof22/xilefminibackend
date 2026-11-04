import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExtraccionDto {
  @ApiProperty({ description: 'Monto extraído' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0.01)
  monto!: number;

  @ApiProperty({ description: 'Causa o motivo de la extracción' })
  @IsString()
  @IsNotEmpty()
  causa!: string;

  @ApiPropertyOptional({ description: 'Fecha de la extracción (ISO)' })
  @IsDateString()
  @IsOptional()
  fecha?: string;

  @ApiPropertyOptional({ description: 'Responsable de la extracción' })
  @IsString()
  @IsOptional()
  responsable?: string;

  @ApiPropertyOptional({
    description: 'Código de la moneda extraída (CUP por defecto)',
    default: 'CUP',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  moneda?: string;

  @ApiPropertyOptional({
    description:
      'Token de acceso (JWT) de un administrador o gerente que autoriza la extracción. ' +
      'Obligatorio si quien extrae no es administrador ni gerente. No se guarda.',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  tokenAutorizador?: string;
}
