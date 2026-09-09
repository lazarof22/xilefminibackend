import { IsEmail, IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { tipoEmpresa } from "../schema/empresa.schema";

export class CreateEmpresaDto {

    @IsNotEmpty()
    @IsString()
    nombreEmpresa!: string;

    @IsNotEmpty()
    @IsString()
    direccionEmpresa!: string;

    @IsNotEmpty()
    @IsString()
    telefonoEmpresa!: string;

    @IsNotEmpty()
    @IsString()
    cuentaBancaria!: string;

    @IsNotEmpty()
    @IsString()
    codigoREU!: string;

    @IsEnum(tipoEmpresa)
    tipoEmpresa!: tipoEmpresa;

    @IsOptional()
    @IsEmail()
    emailEmpresa?: string;

    @IsOptional()
    @IsString()
    sloganEmpresa?: string;

    @IsOptional()
    @IsString()
    ciudadEmpresa?: string;

    @IsOptional()
    @IsMongoId()
    paisEmpresa?: string;
}
