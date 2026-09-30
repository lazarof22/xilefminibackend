import { PartialType } from '@nestjs/mapped-types';
import { CreateContenedorDto } from './create-contenedor.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNotEmpty, IsString, IsNumber, Min, IsMongoId } from 'class-validator';

export class UpdateContenedorDto extends PartialType(CreateContenedorDto) {

    @IsOptional()
    @IsNotEmpty({ message: 'El nombre del contenedor no puede estar vacío' })
    @IsString({ message: 'El nombre del contenedor debe ser una cadena de texto' })
    nombreContenedor?: string;

    
    @IsOptional()
    @IsString({ message: 'El código del contenedor debe ser una cadena de texto' })
    codigoContenedor?: string;

    
    @IsOptional()
    @IsMongoId({ message: 'El almacén debe ser un ID de MongoDB válido' })
    almacen?: string;
}
