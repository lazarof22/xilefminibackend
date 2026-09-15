import { PartialType } from '@nestjs/mapped-types';
import { CrearNomencladorDto } from './crear_nomenclador.dto';

export class ActualizarNomencladorDto extends PartialType(
  CrearNomencladorDto,
) {}