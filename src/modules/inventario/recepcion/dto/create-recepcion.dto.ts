import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { TipoDocumentoOrigen } from '../schema/recepcion.schema';

export class DocumentoOrigenDto {
  @ApiProperty({ enum: TipoDocumentoOrigen })
  @IsEnum(TipoDocumentoOrigen, {
    message: 'El tipo de documento de origen debe ser factura, conduce u otro',
  })
  tipo!: TipoDocumentoOrigen;

  @ApiProperty({ description: 'Número del documento que ampara los productos' })
  @IsString()
  @IsNotEmpty({ message: 'El número del documento de origen es obligatorio' })
  numero!: string;

  @ApiProperty({ example: '2026-10-05' })
  @IsDateString(
    {},
    { message: 'La fecha del documento de origen no es válida' },
  )
  fecha!: string;
}

export class LineaRecepcionDto {
  @ApiProperty({ description: 'ID del producto recibido' })
  @IsMongoId({ message: 'El producto debe ser un ID válido' })
  producto!: string;

  @ApiProperty({
    description: 'ID del contenedor (del almacén receptor) donde queda',
  })
  @IsMongoId({ message: 'El contenedor debe ser un ID válido' })
  contenedor!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt({ message: 'La cantidad debe ser un número entero' })
  @Min(1, { message: 'La cantidad debe ser al menos 1' })
  cantidad!: number;

  @ApiProperty({ minimum: 0, description: 'Costo por unidad' })
  @IsNumber({}, { message: 'El costo unitario debe ser un número' })
  @Min(0, { message: 'El costo unitario no puede ser negativo' })
  costo_unitario!: number;
}

export class CreateRecepcionDto {
  @ApiPropertyOptional({ description: 'Fecha de emisión (por defecto, hoy)' })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha de emisión no es válida' })
  fechaEmision?: string;

  @ApiProperty({ description: 'Almacén que recibe la mercancía' })
  @IsMongoId({ message: 'El almacén receptor debe ser un ID válido' })
  almacenReceptor!: string;

  @ApiProperty({ description: 'Proveedor que entrega' })
  @IsMongoId({ message: 'El proveedor debe ser un ID válido' })
  proveedor!: string;

  @ApiProperty({ type: DocumentoOrigenDto })
  @IsDefined({ message: 'El documento de origen es obligatorio' })
  @ValidateNested()
  @Type(() => DocumentoOrigenDto)
  documentoOrigen!: DocumentoOrigenDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  transportista?: string;

  @ApiProperty({ description: 'Quien comprueba la mercancía recibida' })
  @IsString()
  @IsNotEmpty({ message: 'El responsable de comprobación es obligatorio' })
  responsableComprobacion!: string;

  @ApiProperty({ type: [LineaRecepcionDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'La recepción necesita al menos una línea' })
  @ValidateNested({ each: true })
  @Type(() => LineaRecepcionDto)
  lineas!: LineaRecepcionDto[];
}
