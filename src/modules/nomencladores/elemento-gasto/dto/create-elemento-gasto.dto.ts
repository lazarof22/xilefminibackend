import { IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateElementoGastoDto {
  @ApiProperty({ description: 'Código del elemento de gasto (ej: E01)' })
  @IsString()
  @IsNotEmpty()
  codigo!: string;

  @ApiProperty({ description: 'Nombre del elemento de gasto' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @ApiPropertyOptional({ description: 'Descripción libre del elemento de gasto' })
  @IsString()
  @IsOptional()
  descripcion?: string;

  @ApiPropertyOptional({
    description:
      'ID del elemento de gasto padre (jerarquía). Si no se envía, es raíz.',
  })
  @IsMongoId()
  @IsOptional()
  padre?: string;

  @ApiPropertyOptional({
    description:
      'Nivel en la jerarquía. Si no se envía y hay padre, se calcula como padre.nivel + 1.',
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  nivel?: number;
}
