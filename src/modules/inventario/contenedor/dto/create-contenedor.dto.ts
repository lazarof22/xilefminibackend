import { IsNotEmpty, IsString, IsNumber, Min, IsOptional, IsMongoId } from 'class-validator';
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
}


