import { PartialType } from '@nestjs/swagger';
import { CreateRecepcionDto } from './create-recepcion.dto';

/** Edición de un borrador: cualquier dato de la cabecera o las líneas completas. */
export class UpdateRecepcionDto extends PartialType(CreateRecepcionDto) {}
