import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PagoCheckoutDto } from '../../pago/dto/pago-checkout.dto';

export class ItemCheckoutDto {
  @IsMongoId()
  productoId!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @IsPositive()
  @Max(1_000_000)
  cantidad!: number;

  /** Descuento de la línea en % (0 a 100). El servidor valida el máximo del rol. */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  descuentoPct?: number;
}

export class UbicacionOrigenDto {
  @IsOptional()
  @IsMongoId()
  contenedorId?: string;
}

/**
 * Los totales que el cliente MOSTRÓ al cajero. Son solo informativos: el
 * servidor nunca los usa para cobrar, solo avisa si no coinciden con los suyos.
 */
export class EstimadoClienteDto {
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @IsOptional()
  @IsNumber()
  descuento?: number;

  @IsOptional()
  @IsNumber()
  impuesto?: number;

  @IsOptional()
  @IsNumber()
  total?: number;
}

/**
 * POST /venta/checkout. NO lleva subtotal, impuesto ni totales: los calcula el
 * servidor con los precios y el impuesto vigentes. La cabecera
 * `Idempotency-Key` es obligatoria.
 */
export class CreateCheckoutDto {
  /** Obligatorio para vender a crédito; en los demás pagos es opcional. */
  @IsOptional()
  @IsMongoId()
  clienteId?: string;

  /** Si se indica, el stock se toma solo de ese almacén (modo unificado). */
  @IsOptional()
  @IsMongoId()
  almacenId?: string;

  /** Si se indica, el stock se toma solo de ese contenedor (modo unificado). */
  @IsOptional()
  @ValidateNested()
  @Type(() => UbicacionOrigenDto)
  ubicacionOrigen?: UbicacionOrigenDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemCheckoutDto)
  items!: ItemCheckoutDto[];

  @ValidateNested()
  @Type(() => PagoCheckoutDto)
  pago!: PagoCheckoutDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EstimadoClienteDto)
  estimado?: EstimadoClienteDto;
}
