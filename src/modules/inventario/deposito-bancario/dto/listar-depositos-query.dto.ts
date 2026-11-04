import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class ListarDepositosQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por turno' })
  @IsOptional()
  @IsMongoId()
  turnoCajaId?: string;
}
