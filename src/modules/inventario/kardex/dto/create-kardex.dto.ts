import { Type } from "class-transformer";
import { IsString, IsNotEmpty, IsNumber, ValidateNested, IsDate, IsEnum, IsMongoId, IsPositive, IsOptional } from "class-validator";
import { KardexTipo } from "../schema/kardex.schema";



export class CreateKardexDto {


    @IsMongoId()
    @IsNotEmpty()
    productoId!: string;

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    fecha?: Date;

    @IsEnum(KardexTipo)
    tipo!: KardexTipo;

    @IsNotEmpty()
    @IsNumber()
    @IsPositive()
    cantidad!: number;


    @IsNotEmpty()
    @IsString()
    motivo!: string;



}
