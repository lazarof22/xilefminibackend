import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateDepositoBancarioDto {
  @ApiProperty({
    description: 'Id del turno de caja cuyo efectivo se deposita',
  })
  @IsMongoId()
  turnoCajaId!: string;

  @ApiProperty({ description: 'Monto depositado', minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  monto!: number;

  @ApiPropertyOptional({ description: 'Código de moneda (CUP por defecto)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  moneda?: string;

  @ApiProperty({ description: 'Banco o sucursal' })
  @IsString()
  @IsNotEmpty()
  banco!: string;

  @ApiPropertyOptional({ description: 'Boleta, cheque o comprobante' })
  @IsOptional()
  @IsString()
  referencia?: string;

  @ApiPropertyOptional({
    description: 'Fecha del depósito (ISO); hoy por defecto',
  })
  @IsOptional()
  @IsDateString()
  fecha?: string;
}
