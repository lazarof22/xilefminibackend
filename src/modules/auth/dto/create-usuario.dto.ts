import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ModuloApp, UsuarioRol } from '../schemas/usuarios.schema';

export const CONTRASEÑA_MIN = 6;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUsuarioDto {
  @ApiProperty({ example: 'maria' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  nombre!: string;

  @ApiProperty({ minLength: CONTRASEÑA_MIN })
  @IsString()
  @MinLength(CONTRASEÑA_MIN, {
    message: `La contraseña debe tener al menos ${CONTRASEÑA_MIN} caracteres`,
  })
  @MaxLength(72, { message: 'La contraseña no puede superar 72 caracteres' })
  contraseña!: string;

  @ApiProperty({ enum: UsuarioRol, example: UsuarioRol.CAJERO })
  @IsEnum(UsuarioRol)
  rol!: UsuarioRol;

  @ApiPropertyOptional({
    enum: ModuloApp,
    isArray: true,
    description:
      'Módulos a los que tendrá acceso. Se ignora para el administrador (acceso total).',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(ModuloApp, { each: true })
  modulos?: ModuloApp[];
}
