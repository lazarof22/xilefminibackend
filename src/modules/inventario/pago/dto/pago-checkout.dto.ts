import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CODIGOS_CANAL_PAGO,
  type CanalPago,
} from '../../../nomencladores/canal-pago/canal-pago.catalogo';
import {
  PATRON_CODIGO_PAIS,
  TIPOS_IDENTIDAD,
  type TipoIdentidad,
} from '../../../../common/utils/identidad';
import { TipoCliente } from '../schema/pago_efectivo.schema';
import { TIPOS_CUENTA } from '../schema/pago_transferencia.schema';
import type { TipoCuenta } from '../schema/pago_transferencia.schema';
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

const aCodigoMoneda = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const CODIGO_MONEDA = /^[A-Z0-9]{2,10}$/;

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

  // ── Efectivo y transferencia: moneda ──
  /**
   * Moneda en la que paga el cliente (CUP, USD, EUR...). Sin indicarla es CUP
   * en efectivo; en transferencia, la moneda por defecto del canal (Zelle: USD).
   */
  @IsOptional()
  @Transform(aCodigoMoneda)
  @IsString()
  @Matches(CODIGO_MONEDA, {
    message:
      'La moneda debe ser un código de 2 a 10 letras o números (CUP, USD...)',
  })
  moneda?: string;

  // ── Efectivo (Fase 3) ──
  /**
   * Billetes y monedas recibidos de la moneda del pago: `{ "100": 1, "20": 2 }`
   * (valor → cantidad). Se valida contra las denominaciones activas de la
   * moneda. Para CUP todavía se acepta el desglose anterior (`desglose`).
   */
  @IsOptional()
  @IsObject()
  desgloseDenominaciones?: Record<string, number>;

  /** Moneda en la que se devuelve el cambio; sin indicarla es la misma del pago. */
  @IsOptional()
  @Transform(aCodigoMoneda)
  @IsString()
  @Matches(CODIGO_MONEDA, {
    message:
      'La moneda del cambio debe ser un código de 2 a 10 letras o números (CUP, USD...)',
  })
  monedaCambio?: string;

  // ── Crédito (Fase 3) ──
  /** Con qué se identifica el cliente: CI (persona) o NIT (empresa). Sin indicarlo se toma del cliente. */
  @IsOptional()
  @IsIn(TIPOS_IDENTIDAD)
  tipoIdentidad?: TipoIdentidad;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(20)
  ci?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(25)
  nit?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(25)
  telefono?: string;

  /** Prefijo de país del teléfono: +53, +1... Sin indicarlo, +53. */
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @Matches(PATRON_CODIGO_PAIS, {
    message:
      'El prefijo de país debe ser un + seguido de 1 a 4 dígitos (+53, +1...)',
  })
  codigoPais?: string;

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

  /** Canal de la transferencia (Fase 3). Sin indicarlo es `banco`. */
  @IsOptional()
  @IsIn(CODIGOS_CANAL_PAGO)
  canal?: CanalPago;

  /** Banco del nomenclador (Fase 3). Reemplaza al texto libre `banco`. */
  @IsOptional()
  @IsMongoId()
  bancoId?: string;

  /** Si el número que se escribió es de una cuenta o de una tarjeta. */
  @IsOptional()
  @IsIn(TIPOS_CUENTA)
  tipoCuenta?: TipoCuenta;

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
