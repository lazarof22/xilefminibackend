import {
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GrupoCuenta, NaturalezaCuenta } from '../schema/cuenta.schema';

export class CreateCuentaDto {
  @ApiProperty({
    description: 'Código único de la cuenta contable (ej: 1.1.1)',
  })
  @IsString()
  @IsNotEmpty()
  codigo!: string;

  @ApiProperty({ description: 'Nombre de la cuenta contable' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @ApiProperty({
    enum: NaturalezaCuenta,
    description: 'Naturaleza de la cuenta',
  })
  @IsEnum(NaturalezaCuenta)
  @IsNotEmpty()
  naturaleza!: NaturalezaCuenta;

  @ApiPropertyOptional({
    description: 'ID de la cuenta padre (jerarquía del clasificador)',
  })
  @IsMongoId()
  @IsOptional()
  padre?: string;

  @ApiProperty({ description: 'ID de la moneda (nomenclador)' })
  @IsMongoId()
  @IsNotEmpty()
  moneda!: string;

  @ApiPropertyOptional({
    description: 'Nivel en la jerarquía (se calcula del código si no se envía)',
  })
  @IsNumber()
  @IsOptional()
  @Min(1)
  nivel?: number;

  @ApiPropertyOptional({
    description:
      'Denominación de la cuenta. Si no se envía, se usa el mismo valor que `nombre`.',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  denominacion?: string;

  @ApiPropertyOptional({
    enum: GrupoCuenta,
    description: 'Grupo contable mayor (Activo, Pasivo, Capital, etc.)',
  })
  @IsEnum(GrupoCuenta)
  @IsOptional()
  grupo?: GrupoCuenta;

  @ApiPropertyOptional({
    description: 'Partida contable (sub-clasificador dentro del grupo)',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  partida?: string;

  @ApiPropertyOptional({
    description: 'Elemento contable (sub-clasificador dentro de la partida)',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  elemento?: string;

  @ApiPropertyOptional({
    description: 'Descripción libre de la cuenta contable',
  })
  @IsString()
  @IsOptional()
  descripcion?: string;
}
