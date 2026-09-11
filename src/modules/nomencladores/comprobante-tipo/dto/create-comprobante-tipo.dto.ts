import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateComprobanteTipoDto {
  @ApiProperty({
    description: 'Código único del tipo de comprobante (ej: DIARIO, AJUSTE)',
  })
  @IsString()
  @IsNotEmpty()
  codigo!: string;

  @ApiProperty({ description: 'Nombre del tipo de comprobante' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @ApiPropertyOptional({ description: 'Descripción libre del tipo de comprobante' })
  @IsString()
  @IsOptional()
  descripcion?: string;
}