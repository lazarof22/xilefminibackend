import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsEnum,
  IsPositive,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ItemFacturaDto {
  @ApiProperty({ description: 'Identificador local del item' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ description: 'ID del producto' })
  @IsString()
  @IsNotEmpty()
  productoId!: string;

  @ApiProperty({ description: 'Nombre del producto' })
  @IsString()
  @IsNotEmpty()
  productoNombre!: string;

  @ApiPropertyOptional({ description: 'Unidad de medida' })
  @IsString()
  @IsOptional()
  unidadMedida?: string;

  @ApiProperty({ description: 'Cantidad vendida' })
  @IsNumber()
  @IsPositive()
  cantidad!: number;

  @ApiProperty({ description: 'Precio unitario' })
  @IsNumber()
  @Min(0)
  precio!: number;

  @ApiProperty({ description: 'Costo unitario' })
  @IsNumber()
  @Min(0)
  costo!: number;

  @ApiProperty({ description: 'Descuento porcentual' })
  @IsNumber()
  @Min(0)
  @Max(100)
  descuentoPct!: number;

  @ApiProperty({ description: 'Descuento en monto' })
  @IsNumber()
  @Min(0)
  descuentoMonto!: number;

  @ApiProperty({ description: 'Recargo' })
  @IsNumber()
  @Min(0)
  recargo!: number;

  // `total` is intentionally not accepted here: it is always recomputed
  // server-side from precio/cantidad/descuentos/recargo (see
  // factura-totales.ts) so a client can never inflate or understate it.
}

export class ImpuestoDto {
  @ApiPropertyOptional({ description: 'Tipo de impuesto (ej: ISV)' })
  @IsString()
  @IsOptional()
  tipo?: string;

  @ApiPropertyOptional({ description: 'Porciento del impuesto' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  porciento?: number;

  @ApiPropertyOptional({
    description:
      'Importe del impuesto. Ignorado si porciento esta definido (se recalcula server-side)',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  importe?: number;
}

export class EmisorDatosDto {
  @ApiPropertyOptional({ description: 'Nombre del emisor' })
  @IsString()
  @IsOptional()
  nombre?: string;

  @ApiPropertyOptional({ description: 'NIT del emisor' })
  @IsString()
  @IsOptional()
  nit?: string;

  @ApiPropertyOptional({ description: 'Direccion del emisor' })
  @IsString()
  @IsOptional()
  direccion?: string;

  @ApiPropertyOptional({ description: 'Telefono del emisor' })
  @IsString()
  @IsOptional()
  telefono?: string;

  @ApiPropertyOptional({ description: 'Email del emisor' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Codigo REEUP del emisor' })
  @IsString()
  @IsOptional()
  reeup?: string;

  @ApiPropertyOptional({ description: 'Numero de cuenta bancaria del emisor' })
  @IsString()
  @IsOptional()
  numeroCuenta?: string;

  @ApiPropertyOptional({ description: 'Sucursal bancaria del emisor' })
  @IsString()
  @IsOptional()
  sucursalBancaria?: string;

  @ApiPropertyOptional({ description: 'Registro comercial del emisor' })
  @IsString()
  @IsOptional()
  registroComercial?: string;
}

export class CreateFacturaDto {
  @ApiPropertyOptional({ description: 'Fecha de emision' })
  @IsString()
  @IsOptional()
  fecha?: string;

  @ApiPropertyOptional({ description: 'Nombre del cliente / comprador' })
  @IsString()
  @IsOptional()
  cliente?: string;

  @ApiPropertyOptional({
    description: 'NIT del comprador (obligatorio por Res. 162/2025 ONAT)',
  })
  @IsString()
  @IsOptional()
  nit?: string;

  @ApiPropertyOptional({ description: 'Direccion del comprador' })
  @IsString()
  @IsOptional()
  direccion?: string;

  @ApiPropertyOptional({ description: 'Telefono del comprador' })
  @IsString()
  @IsOptional()
  telefono?: string;

  @ApiPropertyOptional({ description: 'Email del comprador' })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Moneda de pago (default CUP)' })
  @IsString()
  @IsOptional()
  moneda?: string;

  @ApiPropertyOptional({
    description: 'Concepto / descripcion general de la factura',
  })
  @IsString()
  @IsOptional()
  concepto?: string;

  @ApiPropertyOptional({
    type: EmisorDatosDto,
    description: 'Datos del emisor (si no se envian, se toman de EmpresaDatos)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmisorDatosDto)
  emisor?: EmisorDatosDto;

  @ApiPropertyOptional({
    type: ImpuestoDto,
    description: 'Impuesto aplicado (tipo impositivo y porciento)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImpuestoDto)
  impuesto?: ImpuestoDto;

  @ApiProperty({ description: 'Metodo de pago' })
  @IsString()
  @IsNotEmpty()
  metodoPago!: string;

  @ApiProperty({ description: 'Items de la factura', type: [ItemFacturaDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ItemFacturaDto)
  items!: ItemFacturaDto[];

  // id, numero, estado, total, subtotal, descuentoTotal and recargoTotal
  // are intentionally absent: they are always server-computed
  // (FacturaService.create) so a client can never forge them. The global
  // ValidationPipe (whitelist + forbidNonWhitelisted, see src/main.ts)
  // rejects any request that still sends them.

  @ApiPropertyOptional({ enum: ['factura_normal', 'ajuste'] })
  @IsEnum(['factura_normal', 'ajuste'])
  @IsOptional()
  tipo?: string;

  @ApiPropertyOptional({ description: 'Si ya fue impresa' })
  @IsBoolean()
  @IsOptional()
  impreso?: boolean;
}
