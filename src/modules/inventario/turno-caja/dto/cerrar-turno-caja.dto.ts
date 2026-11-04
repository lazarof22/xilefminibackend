import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CerrarTurnoCajaDto {
  @ApiPropertyOptional({ description: 'Observaciones del cierre' })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
