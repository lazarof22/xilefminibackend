import { PartialType } from '@nestjs/mapped-types';
import { CrearValorNomencladorDto } from './crear_valor_nomenclador.dto';

export class ActualizarValorNomencladorDto extends PartialType(
  CrearValorNomencladorDto,
) {}