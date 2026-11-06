import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TipoCliente } from '../schema/pago_efectivo.schema';
import { DatosClienteDescuentoDto } from './create-pago.dto';

export const TIPOS_PAGO_CHECKOUT = [
  'efectivo',
  'credito',
  'transferencia',
] as const;
export type TipoPagoCheckout = (typeof TIPOS_PAGO_CHECKOUT)[number];

/** Billetes y monedas (CUP) del desglose y lo que vale cada uno. */
export const DENOMINACIONES_CUP = [
  ['billete5000', 5000],
  ['billete2000', 2000],
  ['billete1000', 1000],
  ['billete500', 500],
  ['billete200', 200],
  ['billete100', 100],
  ['billete50', 50],
  ['billete20', 20],
  ['billete10', 10],
  ['billete5', 5],
  ['billete3', 3],
  ['billete1', 1],
] as const;

export type ClaveDenominacion = (typeof DENOMINACIONES_CUP)[number][0];

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Cantidad de billetes de cada denominación: enteros de 0 en adelante. */
export class DesgloseCheckoutDto {
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete5000?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete2000?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete1000?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete500?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete200?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete100?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete50?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete20?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete10?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete5?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete3?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) billete1?: number;
}

/**
 * Cómo paga el cliente. NO lleva montos: el total lo calcula el servidor y el
 * efectivo recibido sale de sumar el desglose.
 */
export class PagoCheckoutDto {
  @IsIn(TIPOS_PAGO_CHECKOUT)
  tipo!: TipoPagoCheckout;

  // ── Efectivo ──
  @IsOptional()
  @ValidateNested()
  @Type(() => DesgloseCheckoutDto)
  desglose?: DesgloseCheckoutDto;

  @IsOptional()
  @IsEnum(TipoCliente)
  tipoCliente?: TipoCliente;

  @IsOptional()
  @ValidateNested()
  @Type(() => DatosClienteDescuentoDto)
  datosClienteDescuento?: DatosClienteDescuentoDto;

  // ── Transferencia ──
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(60)
  numeroCuenta?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(60)
  referenciaPago?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(60)
  banco?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(500)
  notas?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(40)
  ciCliente?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(120)
  nombreCliente?: string;
}
