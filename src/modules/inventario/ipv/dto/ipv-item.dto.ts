import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, Min } from 'class-validator';

export class IpvItemDto {
  @ApiProperty({ description: 'ID del producto' })
  @IsMongoId({ message: 'El producto debe ser un ID de MongoDB válido' })
  producto!: string;

  @ApiPropertyOptional({ description: 'Precio de costo usado en el IPV' })
  @IsOptional()
  @IsNumber({}, { message: 'El precio de costo debe ser un número' })
  @Min(0, { message: 'El precio de costo no puede ser negativo' })
  precioCosto?: number;

  @ApiPropertyOptional({ description: 'Precio de venta usado en el IPV' })
  @IsOptional()
  @IsNumber({}, { message: 'El precio de venta debe ser un número' })
  @Min(0, { message: 'El precio de venta no puede ser negativo' })
  precioVenta?: number;

  @ApiProperty()
  @IsNumber({}, { message: 'El inventario inicial debe ser un número' })
  @Min(0, { message: 'El inventario inicial no puede ser negativo' })
  inventarioInicial!: number;

  @ApiProperty()
  @IsNumber({}, { message: 'Las entradas deben ser un número' })
  @Min(0, { message: 'Las entradas no pueden ser negativas' })
  entradas!: number;

  @ApiProperty()
  @IsNumber({}, { message: 'El ajuste por disminución debe ser un número' })
  @Min(0, { message: 'El ajuste por disminución no puede ser negativo' })
  ajusteDisminucion!: number;

  @ApiProperty()
  @IsNumber({}, { message: 'La venta debe ser un número' })
  @Min(0, { message: 'La venta no puede ser negativa' })
  venta!: number;
}
