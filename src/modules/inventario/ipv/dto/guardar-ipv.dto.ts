import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, ValidateNested } from 'class-validator';
import { IpvItemDto } from './ipv-item.dto';

export class GuardarIpvDto {
  @ApiProperty({ example: '2026-10-14', description: 'Día del IPV' })
  @IsDateString({}, { message: 'La fecha debe tener formato AAAA-MM-DD' })
  fecha!: string;

  @ApiProperty({ type: [IpvItemDto] })
  @IsArray({ message: 'items debe ser un arreglo' })
  @ValidateNested({ each: true })
  @Type(() => IpvItemDto)
  items!: IpvItemDto[];
}
