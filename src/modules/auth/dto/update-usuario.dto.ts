import { PartialType } from '@nestjs/swagger';
import { CreateUsuarioDto } from './create-usuario.dto';

/** Todos los campos son opcionales; la contraseña solo cambia si se envía. */
export class UpdateUsuarioDto extends PartialType(CreateUsuarioDto) {}
