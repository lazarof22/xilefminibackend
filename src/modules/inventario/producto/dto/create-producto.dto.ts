import { IsIn, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Types } from "mongoose";
import { GRAVADO_VALORES } from "../schemas/producto.schema";
import type { Gravado } from "../schemas/producto.schema";

export class CreateProductoDto {

    @IsString()
    @IsNotEmpty()
    codigo_producto!: string;

    @IsString()
    @IsNotEmpty()
    nombre_producto!: string;

    @IsString()
    @IsNotEmpty()
    categoria_producto!: string;


    @IsNotEmpty()
    @IsNumber()
    @Min(0, { message: 'El precio de compra no puede ser negativo' })
    precio_compra!: number;


    @IsNotEmpty()
    @IsNumber()
    @Min(0, { message: 'El precio de venta no puede ser negativo' })
    precio_venta!: number;


    @IsNotEmpty()
    @IsNumber()
    @Min(0, { message: 'El stock no puede ser negativo' })
    stock_inicial!: number;


    @IsNotEmpty()
    @IsNumber()
    @Min(0, { message: 'El stock mínimo no puede ser negativo' })
    stock_minimo!: number;

    @IsString()
    @IsNotEmpty()
    estado!: string;

    @ApiPropertyOptional({
        enum: GRAVADO_VALORES,
        default: 'gravado',
        description: 'Tratamiento tributario; los productos exentos no calculan impuesto.',
    })
    @IsOptional()
    @IsIn(GRAVADO_VALORES, { message: 'gravado debe ser "gravado" o "exento"' })
    gravado?: Gravado;

    @IsOptional()
    @IsMongoId()
    almacen?: Types.ObjectId;

    @IsOptional()
    @IsMongoId()
    contenedor?: Types.ObjectId;
}
