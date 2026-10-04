import { IsEnum, IsNumber, IsOptional, IsBoolean, Min, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTasaDto {
  @ApiProperty( )
  @IsString()
  moneda!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  tasaBancoCentral!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  tasaMercadoInformal!: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  iva?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
