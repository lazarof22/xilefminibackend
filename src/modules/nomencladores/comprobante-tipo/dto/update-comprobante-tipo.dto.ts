import { PartialType } from '@nestjs/swagger';
import { CreateComprobanteTipoDto } from './create-comprobante-tipo.dto';

export class UpdateComprobanteTipoDto extends PartialType(
  CreateComprobanteTipoDto,
) {}