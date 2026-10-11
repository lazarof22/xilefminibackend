import { ApiProperty } from '@nestjs/swagger';

/** Una fila del reporte de inventario (un producto). */
export class ReporteInventarioItemDto {
  @ApiProperty({
    description: '_id del producto',
    example: '6abf0da4f4a95d02f5df6ef2',
  })
  _id!: string;

  @ApiProperty({ example: 'P-001' })
  codigo_producto!: string;

  @ApiProperty({ example: 'Televisor Hisense 32"' })
  nombre_producto!: string;

  @ApiProperty({
    description: 'Unidades existentes en el inventario (stock del producto)',
    example: 50,
  })
  productos_disponibles!: number;

  @ApiProperty({
    description:
      'Unidades reservadas por facturación (0 mientras ese módulo no las informe)',
    example: 0,
  })
  productos_reservados!: number;

  @ApiProperty({
    description: 'Productos disponibles − productos reservados',
    example: 50,
  })
  inventario_total!: number;
}
