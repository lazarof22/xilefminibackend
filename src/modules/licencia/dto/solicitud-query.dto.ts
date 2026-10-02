import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EMPRESA_ID_MAX_LENGTH } from '../services/payload-builder';

export class SolicitudQueryDto {
  @ApiPropertyOptional({
    description: 'Defaults to the empresa_id of the JWT',
    maxLength: EMPRESA_ID_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(EMPRESA_ID_MAX_LENGTH)
  empresa_id?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'true → Content-Disposition attachment (.req file)',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  descargar?: 'true' | 'false';
}
