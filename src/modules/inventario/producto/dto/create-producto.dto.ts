import { IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { Types } from "mongoose";

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
    precio_compra!: number;


    @IsNotEmpty()
    @IsNumber()
    precio_venta!: number;


    @IsNotEmpty()
    @IsNumber()
    stock_inicial!: number;


    @IsNotEmpty()
    @IsNumber()
    stock_minimo!: number;

    @IsString()
    @IsNotEmpty()
    estado!: string;

    @IsOptional()
    @IsMongoId()
    almacen?: Types.ObjectId;

    @IsOptional()
    @IsMongoId()
    contenedor?: Types.ObjectId;
}
