import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { EstadoTurnoCaja } from '../schema/turno-caja.schema';

export class ListarTurnosCajaQueryDto {
  @ApiPropertyOptional({ enum: EstadoTurnoCaja })
  @IsOptional()
  @IsEnum(EstadoTurnoCaja)
  estado?: EstadoTurnoCaja;

  @ApiPropertyOptional({ description: 'Id del cajero' })
  @IsOptional()
  @IsMongoId()
  cajeroId?: string;
}
