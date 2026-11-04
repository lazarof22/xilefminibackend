import { Type } from "class-transformer";
import { IsString, IsNotEmpty, IsNumber, ValidateNested, IsDate, IsEnum, IsMongoId, IsPositive, IsOptional, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
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

    /** Documento que origina el movimiento (p. ej. `AJU-000012`). */
    @ApiPropertyOptional({ description: 'Documento que origina el movimiento' })
    @IsOptional()
    @IsString()
    referencia?: string;

    /** Submayor SC-2-13: importe del movimiento en pesos (CUP). */
    @ApiPropertyOptional({ description: 'Importe del movimiento en CUP', minimum: 0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    importeCUP?: number;

    /** Submayor SC-2-13: importe del movimiento en divisa. */
    @ApiPropertyOptional({ description: 'Importe del movimiento en divisa', minimum: 0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    importeDivisa?: number;

    /** Submayor SC-2-13: costo promedio unitario tras el movimiento. */
    @ApiPropertyOptional({ description: 'Costo promedio unitario', minimum: 0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    costoPromedio?: number;

    /** Submayor SC-2-13: ubicación física (almacén / contenedor / casilla). */
    @ApiPropertyOptional({ description: 'Ubicación física del movimiento' })
    @IsOptional()
    @IsString()
    ubicacionFisica?: string;

    /** Submayor SC-2-13: referencia al documento contable de origen. */
    @ApiPropertyOptional({ description: 'Referencia contable del documento de origen' })
    @IsOptional()
    @IsString()
    referenciaContable?: string;



}
