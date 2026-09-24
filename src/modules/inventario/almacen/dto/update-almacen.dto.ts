import { PartialType } from '@nestjs/mapped-types';
import { CreateAlmacenDto } from './create-almacen.dto';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsNotEmpty, IsString, IsNumber, Min, MaxLength } from 'class-validator';

export class UpdateAlmacenDto extends PartialType(CreateAlmacenDto) {
    @IsOptional()
    @IsNotEmpty({ message: 'El nombre del almacén no puede estar vacío' })
    @IsString({ message: 'El nombre debe ser una cadena de texto' })
    nombreAlmacen?: string;

    @IsOptional()
    @IsNumber({}, { message: 'La cantidad de contenedores debe ser un número' })
    @Min(0, { message: 'La cantidad de contenedores no puede ser negativa' })
    cantidadContenedores?: number;

    @IsOptional()
    @IsNotEmpty({ message: 'El código del almacén no puede estar vacío' })
    @IsString({ message: 'El código debe ser una cadena de texto' })
    @MaxLength(20, { message: 'El código no puede tener más de 20 caracteres' })
    codigo?: string;
}
