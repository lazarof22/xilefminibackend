import { PartialType } from '@nestjs/mapped-types';
import { CreateCausaDisminucionDto } from './create-causa-disminucion.dto';

export class UpdateCausaDisminucionDto extends PartialType(
  CreateCausaDisminucionDto,
) {}
