import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { EstrategiaConciliacion } from '../schema/conciliacion-existencia.schema';

/** Cantidad contada en una ubicación concreta. */
export class UbicacionConteoDto {
  @IsMongoId()
  @IsNotEmpty()
  almacenId!: string;

  @IsMongoId()
  @IsNotEmpty()
  contenedorId!: string;

  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  @Type(() => Number)
  cantidad!: number;
}

export class ResolverConciliacionDto {
  @IsMongoId()
  @IsNotEmpty()
  productoId!: string;

  /**
   * - `stock_producto`: el stock del producto es el correcto → se ajustan las existencias.
   * - `existencias`: las existencias son las correctas → se ajusta el stock del producto.
   * - `conteo`: conteo físico por ubicación (`ubicaciones` es obligatorio).
   */
  @IsEnum(EstrategiaConciliacion)
  estrategia!: EstrategiaConciliacion;

  /**
   * `conteo`: cantidad real contada en cada ubicación (las ubicaciones del
   * producto que no se mencionen conservan su cantidad).
   * `stock_producto`: solo hace falta (una ubicación) si el producto no
   * tiene ninguna existencia y no tiene ubicación por defecto válida.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UbicacionConteoDto)
  ubicaciones?: UbicacionConteoDto[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacion?: string;
}
