import { IsNotEmpty, IsString, IsNumber, Min, IsOptional, IsMongoId, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Types } from 'mongoose';

export class CreateContenedorDto {

    
    @IsNotEmpty({ message: 'El nombre del contenedor no puede estar vacío' })
    @IsString({ message: 'El nombre del contenedor debe ser una cadena de texto' })
    nombreContenedor!: string;

    @IsNotEmpty({ message: 'El código del contenedor no puede estar vacío' })
    @IsString({ message: 'El código del contenedor debe ser una cadena de texto' })
    codigoContenedor!: string;

    
    @IsNotEmpty({ message: 'El almacén es obligatorio' })
    @IsMongoId({ message: 'El almacén debe ser un ID de MongoDB válido' })
    almacen!: string;

    @ApiPropertyOptional({ description: 'Sección del almacén donde está el contenedor', maxLength: 50 })
    @IsOptional()
    @IsString({ message: 'La sección debe ser una cadena de texto' })
    @MaxLength(50, { message: 'La sección no puede tener más de 50 caracteres' })
    seccion?: string;

    @ApiPropertyOptional({ description: 'Estante donde está el contenedor', maxLength: 50 })
    @IsOptional()
    @IsString({ message: 'El estante debe ser una cadena de texto' })
    @MaxLength(50, { message: 'El estante no puede tener más de 50 caracteres' })
    estante?: string;

    @ApiPropertyOptional({ description: 'Casilla del estante donde está el contenedor', maxLength: 50 })
    @IsOptional()
    @IsString({ message: 'La casilla debe ser una cadena de texto' })
    @MaxLength(50, { message: 'La casilla no puede tener más de 50 caracteres' })
    casilla?: string;
}


