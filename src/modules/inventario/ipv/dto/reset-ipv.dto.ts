import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class ResetIpvDto {
  @ApiProperty({ example: '2026-10-14', description: 'Día a reiniciar' })
  @IsDateString({}, { message: 'La fecha debe tener formato AAAA-MM-DD' })
  fecha!: string;
}
