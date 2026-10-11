import { IsNotEmpty, IsString } from "class-validator";

export class CreateMonedaDto {


    @IsString()
    @IsNotEmpty()
    nombre_moneda!: string;

    @IsString()
    @IsNotEmpty()
    tipo_moneda!: string;
}
