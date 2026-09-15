import { IsBoolean } from 'class-validator';

export class CambiarEstadoDto {
  @IsBoolean()
  activo!: boolean;
}