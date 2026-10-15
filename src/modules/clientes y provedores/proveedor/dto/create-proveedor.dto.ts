import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateProveedorDto {
  @ApiProperty({ example: 'PRV-001' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El código es obligatorio' })
  @MaxLength(30)
  codigo!: string;

  @ApiProperty({ example: 'Distribuidora Caribe S.A.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(120)
  nombre!: string;

  @ApiProperty({ example: '9225 1234 5678 9012' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'La cuenta bancaria es obligatoria' })
  @MaxLength(40)
  cuentaBancaria!: string;

  @ApiProperty({ example: 'Calle 23 #456, Vedado, La Habana' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'La dirección es obligatoria' })
  @MaxLength(200)
  direccion!: string;

  @ApiProperty({ example: 53555000, description: 'Solo dígitos' })
  @Type(() => Number)
  @IsInt({ message: 'El teléfono debe ser un número entero (solo dígitos)' })
  @Min(0, { message: 'El teléfono no puede ser negativo' })
  @Max(999999999999999, { message: 'El teléfono es demasiado largo' })
  telefono!: number;
}
