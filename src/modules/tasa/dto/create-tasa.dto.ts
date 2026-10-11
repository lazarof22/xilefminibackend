import {
    IsNumber,
    IsOptional,
    IsBoolean,
    Min,
    IsString,
    IsDateString,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateTasaDto {
    @ApiProperty({ example: "USD" })
    @IsString()
    moneda!: string;

    @ApiProperty({ example: 300 })
    @IsNumber()
    @Min(0)
    tasaBancoCentral!: number;

    @ApiProperty({ example: 400 })
    @IsNumber()
    @Min(0)
    tasaMercadoInformal!: number;

    @ApiProperty({ required: false, default: 0 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    iva?: number;

    @ApiProperty({ required: false, default: true })
    @IsOptional()
    @IsBoolean()
    activa?: boolean;

    @ApiProperty({
        required: false,
        example: "2026-10-10T20:30:00.000Z",
    })
    @IsOptional()
    @IsDateString()
    fechaActualizacion?: string;
}
