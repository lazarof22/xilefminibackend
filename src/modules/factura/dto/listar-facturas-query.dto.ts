import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  FACTURA_LISTADO_LIMITE_DEFECTO,
  FACTURA_LISTADO_LIMITE_MAXIMO,
  FACTURA_LISTADO_PAGINA_DEFECTO,
} from '../factura.constants';

export class ListarFacturasQueryDto {
  @ApiPropertyOptional({
    description: 'Numero de pagina (1-indexado)',
    default: FACTURA_LISTADO_PAGINA_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: `Cantidad de resultados por pagina (maximo ${FACTURA_LISTADO_LIMITE_MAXIMO})`,
    default: FACTURA_LISTADO_LIMITE_DEFECTO,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FACTURA_LISTADO_LIMITE_MAXIMO)
  limit?: number;
}
