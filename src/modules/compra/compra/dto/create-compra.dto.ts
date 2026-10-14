import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Pago } from '../schema/compra.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCompraDto {
  @ApiProperty({ example: 'F-0001' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  numeroFactura!: string;

  @ApiProperty({
    description: 'Nombre de la empresa proveedora (módulo empresa)',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  nombreProveedor!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  nombreProducto!: string;

  @ApiProperty({ example: '2026-10-13' })
  @IsDateString()
  fechaCompra!: string;

  @ApiProperty({ example: 'USD' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  moneda!: string;

  @ApiPropertyOptional({
    description: 'Solo si la moneda no es CUP y el proveedor es Mypime',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tasaMercadoInformal?: number;

  @ApiPropertyOptional({
    description: 'Solo si la moneda no es CUP y el proveedor NO es Mypime',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tasaBancoNacional?: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  precioCompra!: number;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  cantidad!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  iva!: number;

  @ApiProperty({ enum: Pago })
  @IsEnum(Pago)
  metodoPago!: Pago;
}
