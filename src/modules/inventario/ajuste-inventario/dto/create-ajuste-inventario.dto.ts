import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmpty,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';

const SALDO_DEL_SERVIDOR = 'El saldo antes y después lo calcula el servidor';

export class LineaAjusteDto {
  @ApiProperty({ description: 'ID del producto' })
  @IsMongoId({ message: 'El producto debe ser un ID válido' })
  producto!: string;

  @ApiProperty({ description: 'ID del almacén del ajuste' })
  @IsMongoId({ message: 'El almacén debe ser un ID válido' })
  almacen!: string;

  @ApiProperty({ description: 'ID del contenedor del ajuste' })
  @IsMongoId({ message: 'El contenedor debe ser un ID válido' })
  contenedor!: string;

  @ApiProperty({
    description:
      'Cantidad con signo: positiva suma, negativa resta; no puede ser cero',
    example: -2,
  })
  @IsNumber({}, { message: 'El ajuste debe ser un número' })
  ajuste!: number;

  /** No se acepta: el servidor lo lee de `Existencia`. */
  @IsEmpty({ message: SALDO_DEL_SERVIDOR })
  saldoAntes?: never;

  /** No se acepta: el servidor lo calcula. */
  @IsEmpty({ message: SALDO_DEL_SERVIDOR })
  saldoDespues?: never;
}

export class CreateAjusteInventarioDto {
  @ApiProperty({
    description: 'Causa del ajuste (las disminuciones usan el nomenclador)',
  })
  @IsString()
  @IsNotEmpty({ message: 'La causa del ajuste es obligatoria' })
  causa!: string;

  @ApiProperty({
    description: 'Quien autoriza el ajuste (administrador o económico)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Debe indicar quién autoriza el ajuste' })
  autorizadoPor!: string;

  @ApiProperty({ description: 'Quien firma el documento (evidencia)' })
  @IsString()
  @IsNotEmpty({ message: 'La firma del ajuste es obligatoria' })
  firmadoPor!: string;

  @ApiProperty({ type: [LineaAjusteDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'El ajuste necesita al menos una línea' })
  @ValidateNested({ each: true })
  @Type(() => LineaAjusteDto)
  lineas!: LineaAjusteDto[];
}
