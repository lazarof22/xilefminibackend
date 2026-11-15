import { PartialType } from '@nestjs/mapped-types';
import { CreateDenominacionMonedaDto } from './create-denominacion-moneda.dto';

export class UpdateDenominacionMonedaDto extends PartialType(
  CreateDenominacionMonedaDto,
) {}
