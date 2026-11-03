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

    /**
     * Modo unificado: ubicación del ajuste. Opcional; si se omite, la entrada
     * va a la ubicación por defecto del producto y la salida se reparte
     * entre sus ubicaciones (primero la ubicación por defecto).
     */
    @IsOptional()
    @IsMongoId()
    almacenId?: string;

    @IsOptional()
    @IsMongoId()
    contenedorId?: string;



}
