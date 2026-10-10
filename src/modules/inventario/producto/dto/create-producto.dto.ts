import { IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";
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

    @IsOptional()
    @IsMongoId()
    almacen?: Types.ObjectId;

    @IsOptional()
    @IsMongoId()
    contenedor?: Types.ObjectId;
}
