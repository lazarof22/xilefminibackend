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
    description:
      'Unidades disponibles. Con existencias unificadas: Σ disponible (cantidad − reservada) de sus ubicaciones; antes de unificar: stock del producto',
    example: 50,
  })
  productos_disponibles!: number;

  @ApiProperty({
    description:
      'Unidades reservadas. Con existencias unificadas: Σ reservada de sus ubicaciones; antes de unificar: 0 mientras el módulo de reservas no las informe',
    example: 0,
  })
  productos_reservados!: number;

  @ApiProperty({
    description:
      'Con existencias unificadas: existencia FÍSICA (Σ cantidad), no el disponible; antes de unificar: productos disponibles − productos reservados',
    example: 50,
  })
  inventario_total!: number;
}
