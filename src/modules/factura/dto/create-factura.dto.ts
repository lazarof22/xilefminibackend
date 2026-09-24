import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  ValidateIf,
  IsEnum,
  IsPositive,
  Min,
  Max,
  MaxLength,
  Matches,
  IsDateString,
  IsMongoId,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoPago } from '../factura.constants';

export class ItemFacturaDto {
  @ApiProperty({ description: 'Identificador local del item' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ description: 'ID del producto' })
  @IsMongoId({ message: 'El producto debe ser un ID de MongoDB válido' })
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

/**
 * "Despachado por" / "Transportado por" / "Recibido por" (T3, spec "TABLA
 * DE UNA FACTURA", signatures excluded). Free data (name, CI, date), not a
 * system user reference: `ci` is only length-bounded, not the strict
 * 11-digit Cuban CI format used for employees, because a transporter or
 * receiver may be a foreigner with a different document.
 */
export class ParticipanteFacturaDto {
  @ApiProperty({ description: 'Nombre completo' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;

  @ApiProperty({
    description:
      'Carné de identidad u otro documento de identificación (puede ser extranjero)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  ci!: string;

  @ApiProperty({ description: 'Fecha (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  @IsDateString(
    { strict: true },
    { message: 'fecha debe ser una fecha de calendario valida' },
  )
  fecha!: string;
}

export class CreateFacturaDto {
  @ApiPropertyOptional({
    description:
      'Fecha de emision (YYYY-MM-DD). Si no se envia, el servidor calcula la fecha actual en America/Havana',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fecha debe tener el formato YYYY-MM-DD',
  })
  @IsDateString(
    { strict: true },
    { message: 'fecha debe ser una fecha de calendario valida' },
  )
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

  @ApiProperty({
    description:
      'ID del almacén (central) desde el que se factura. El servidor valida que exista, tenga codigo configurado, y que cada item pertenezca a este almacén (cuando el producto tiene almacen asignado)',
  })
  @IsMongoId({ message: 'El almacén debe ser un ID de MongoDB válido' })
  @IsNotEmpty()
  almacenId!: string;

  // almacenCodigo is intentionally absent: it is always taken server-side
  // from the loaded Almacen (FacturaService.obtenerAlmacenValido), a
  // snapshot the client can never forge. The global ValidationPipe
  // (whitelist + forbidNonWhitelisted) rejects any request that sends it.

  // emisor is intentionally absent: it is always taken server-side from
  // EmpresaDatos (FacturaService.obtenerEmisor), never from the client, so
  // an invoice can never be forged with a fake issuer. The global
  // ValidationPipe (whitelist + forbidNonWhitelisted) rejects any request
  // that still sends it.

  @ApiPropertyOptional({
    type: ImpuestoDto,
    description: 'Impuesto aplicado (tipo impositivo y porciento)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImpuestoDto)
  impuesto?: ImpuestoDto;

  @ApiProperty({
    description: 'Metodo de pago',
    enum: TipoPago,
  })
  @IsEnum(TipoPago)
  metodoPago!: TipoPago;

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

  // No @IsOptional(): that also skips validation for `null`, which would
  // let a request silently erase a participant with a null instead of
  // just omitting it (same reasoning as UpdateAlmacenDto.codigo, T2b).
  @ApiPropertyOptional({
    type: ParticipanteFacturaDto,
    description: 'Despachado por',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => ParticipanteFacturaDto)
  despachadoPor?: ParticipanteFacturaDto;

  @ApiPropertyOptional({
    type: ParticipanteFacturaDto,
    description: 'Transportado por',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => ParticipanteFacturaDto)
  transportadoPor?: ParticipanteFacturaDto;

  @ApiPropertyOptional({
    type: ParticipanteFacturaDto,
    description: 'Recibido por',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateNested()
  @Type(() => ParticipanteFacturaDto)
  recibidoPor?: ParticipanteFacturaDto;

  // Same @ValidateIf reasoning as the participants above: `null` must be
  // rejected, not silently treated as absent.
  @ApiPropertyOptional({
    description: 'Numero de talonario / recibo asociado a la factura',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  talonario?: string;
}
