import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DevolucionOrigenTipo,
  DevolucionTipo,
  FormaDevolucionDinero,
} from '../schema/devolucion.schema';

export class LineaDevolucionDto {
  @ApiProperty({ description: 'Producto del documento de origen' })
  @IsMongoId()
  producto!: string;

  @ApiProperty({
    description: 'Cantidad que pide devolver el cliente',
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidadSolicitada!: number;

  @ApiProperty({
    description:
      'Cantidad realmente recibida/entregada; es la que mueve el stock',
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cantidadEntregada!: number;
}

export class CreateDevolucionDto {
  @ApiProperty({ enum: DevolucionTipo })
  @IsEnum(DevolucionTipo)
  tipo!: DevolucionTipo;

  @ApiProperty({
    enum: DevolucionOrigenTipo,
    description:
      'Documento de origen: venta o factura (tipo venta); registro_compra (tipo proveedor)',
  })
  @IsEnum(DevolucionOrigenTipo)
  origenTipo!: DevolucionOrigenTipo;

  @ApiProperty({ description: 'Id del documento de origen (obligatorio)' })
  @IsMongoId()
  origenRef!: string;

  @ApiProperty({ description: 'Motivo de la devolución (obligatorio)' })
  @IsString()
  @IsNotEmpty()
  motivo!: string;

  @ApiProperty({ type: [LineaDevolucionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineaDevolucionDto)
  lineas!: LineaDevolucionDto[];

  @ApiProperty({ description: 'Quien autoriza la devolución' })
  @IsString()
  @IsNotEmpty()
  autorizadoPor!: string;

  @ApiProperty({ description: 'Quien recibe la mercancía' })
  @IsString()
  @IsNotEmpty()
  recibidoPor!: string;

  @ApiProperty({ description: 'Firma (evidencia de aceptación)' })
  @IsString()
  @IsNotEmpty()
  firma!: string;

  @ApiPropertyOptional({
    enum: FormaDevolucionDinero,
    description:
      'Opcional: el servidor deduce la forma del pago original. Si se envía y no es coherente con el pago original, se rechaza.',
  })
  @IsOptional()
  @IsEnum(FormaDevolucionDinero)
  formaDevolucionDinero?: FormaDevolucionDinero;
}
