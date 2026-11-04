import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateConfiguracionDepositoDto {
  @ApiPropertyOptional({
    description: 'Activa las alertas de plazo (apagadas por defecto)',
  })
  @IsOptional()
  @IsBoolean()
  alertasActivas?: boolean;

  @ApiPropertyOptional({
    description: 'Días hábiles para depositar un turno cerrado',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  plazoDiasHabiles?: number;

  @ApiPropertyOptional({
    description: 'Máximo de días entre depósitos',
    default: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDiasEntreDepositos?: number;
}
