import {
    IsDateString,
    IsInt,
    IsMongoId,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRegistroCompraDto {
    @ApiProperty({ description: 'ID del producto comprado' })
    @IsNotEmpty({ message: 'El producto es obligatorio' })
    @IsMongoId({ message: 'El producto debe ser un ID de MongoDB válido' })
    producto!: string;

    @ApiProperty({ description: 'ID del almacén donde se recibe la compra' })
    @IsNotEmpty({ message: 'El almacén es obligatorio' })
    @IsMongoId({ message: 'El almacén debe ser un ID de MongoDB válido' })
    almacen!: string;

    @ApiProperty({ description: 'ID del contenedor donde se recibe la compra' })
    @IsNotEmpty({ message: 'El contenedor es obligatorio' })
    @IsMongoId({ message: 'El contenedor debe ser un ID de MongoDB válido' })
    contenedor!: string;

    @ApiProperty({ description: 'Unidades compradas', minimum: 1 })
    @IsNotEmpty({ message: 'La cantidad es obligatoria' })
    @IsInt({ message: 'La cantidad debe ser un número entero' })
    @Min(1, { message: 'La cantidad debe ser al menos 1' })
    cantidad!: number;

    @ApiProperty({ description: 'Costo por unidad', minimum: 0 })
    @IsNotEmpty({ message: 'El costo unitario es obligatorio' })
    @IsNumber({}, { message: 'El costo unitario debe ser un número' })
    @Min(0, { message: 'El costo unitario no puede ser negativo' })
    costo_unitario!: number;

    @ApiPropertyOptional({
        description: 'Fecha de la compra (por defecto, la fecha actual)',
        example: '2026-10-05',
    })
    @IsOptional()
    @IsDateString({}, { message: 'La fecha debe ser una fecha válida' })
    fecha?: string;
}
