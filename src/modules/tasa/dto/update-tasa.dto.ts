import { PartialType } from '@nestjs/mapped-types';
import { CreateTasaDto } from './create-tasa.dto';

export class UpdateTasaDto extends PartialType(CreateTasaDto) {}
