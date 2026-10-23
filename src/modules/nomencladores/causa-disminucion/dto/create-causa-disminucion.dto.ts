import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCausaDisminucionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre_causa!: string;
}
