import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCiudadDto {
  @ApiProperty({ example: 'La Habana' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombreCiudad!: string;

  @ApiProperty({
    example: '665f1c2e9b1d4a0012345678',
    description: 'ObjectId del país',
  })
  @IsMongoId({ message: 'El país seleccionado no es válido' })
  pais!: string;
}
