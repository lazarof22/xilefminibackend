import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsMongoId,
  Min,
  IsOptional,
  IsDateString,
  IsString,
  ValidateNested,
  IsArray,
  ArrayMinSize,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DesgloseBilletesDto {
  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete5000?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete2000?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete1000?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete500?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete200?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete100?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete50?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete20?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete10?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete5?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete3?: number = 0;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @IsOptional()
  billete1?: number = 0;
}

export class OtroMotivoDto {
  @ApiProperty({ description: 'Descripción del concepto' })
  @IsNotEmpty({ message: 'El concepto es obligatorio' })
  @IsString()
  concepto!: string;

  @ApiProperty({ description: 'Monto', minimum: 0 })
  @IsNotEmpty()
  @IsNumber({}, { message: 'El monto debe ser un número' })
  @Min(0)
  monto!: number;

  @ApiProperty({
    description: 'Tipo: ingreso (+) o egreso (-)',
    enum: ['ingreso', 'egreso'],
  })
  @IsNotEmpty()
  @IsString()
  @IsEnum(['ingreso', 'egreso'], {
    message: 'El tipo debe ser ingreso o egreso',
  })
  tipo!: string;
}

export class CreateCuadreCajaDto {
  @ApiPropertyOptional({
    description: 'Fecha del cuadre (por defecto la fecha actual)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'La fecha debe ser una fecha válida' })
  fecha?: string;

  @ApiProperty({ description: 'ID del empleado' })
  @IsNotEmpty({ message: 'El empleado es obligatorio' })
  @IsMongoId({ message: 'El empleado debe ser un ID de MongoDB válido' })
  empleado!: string;

  @ApiProperty({ description: 'Créditos / Cuentas por cobrar', minimum: 0 })
  @IsNotEmpty({ message: 'Los créditos son obligatorios' })
  @IsNumber({}, { message: 'Los créditos deben ser un número' })
  @Min(0, { message: 'Los créditos no pueden ser negativos' })
  creditos!: number;

  @ApiProperty({ description: 'Total de ventas del día', minimum: 0 })
  @IsNotEmpty({ message: 'El total de ventas del día es obligatorio' })
  @IsNumber({}, { message: 'El total de ventas del día debe ser un número' })
  @Min(0, { message: 'El total de ventas del día no puede ser negativo' })
  total_ventas_dia!: number;

  @ApiProperty({ description: 'Total de extracciones del día', minimum: 0 })
  @IsNotEmpty({ message: 'El total de extracciones del día es obligatorio' })
  @IsNumber(
    {},
    { message: 'El total de extracciones del día debe ser un número' },
  )
  @Min(0, { message: 'El total de extracciones del día no puede ser negativo' })
  total_extracciones_dia!: number;

  @ApiProperty({ description: 'Desglose de billetes' })
  @ValidateNested()
  @Type(() => DesgloseBilletesDto)
  desglose_billetes!: DesgloseBilletesDto;

  @ApiProperty({ description: 'Valor de las transferencias', minimum: 0 })
  @IsNotEmpty({ message: 'El valor de las transferencias es obligatorio' })
  @IsNumber(
    {},
    { message: 'El valor de las transferencias debe ser un número' },
  )
  @Min(0, { message: 'El valor de las transferencias no puede ser negativo' })
  valor_transferencias!: number;

  @ApiProperty({ description: 'Recargos', minimum: 0 })
  @IsNotEmpty({ message: 'Los recargos son obligatorios' })
  @IsNumber({}, { message: 'Los recargos deben ser un número' })
  @Min(0, { message: 'Los recargos no pueden ser negativos' })
  recargos!: number;

  @ApiProperty({ description: 'Descuentos', minimum: 0 })
  @IsNotEmpty({ message: 'Los descuentos son obligatorios' })
  @IsNumber({}, { message: 'Los descuentos deben ser un número' })
  @Min(0, { message: 'Los descuentos no pueden ser negativos' })
  descuentos!: number;

  @ApiProperty({
    description: 'Lista de otros motivos (concepto, monto, tipo)',
  })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => OtroMotivoDto)
  otros_motivos!: OtroMotivoDto[];

  @ApiPropertyOptional({
    description:
      'Total de efectivo contado. Si no se envía, se calcula desde el desglose de billetes',
  })
  @IsOptional()
  @IsNumber({}, { message: 'El total de efectivo debe ser un número' })
  @Min(0, { message: 'El total de efectivo no puede ser negativo' })
  total_efectivo?: number;

  @ApiPropertyOptional({
    description:
      'Moneda del cuadre (código; CUP por defecto). El cuadre compara solo contra el efectivo esperado de esa moneda.',
    default: 'CUP',
  })
  @IsOptional()
  @IsString({ message: 'La moneda debe ser texto' })
  @IsNotEmpty({ message: 'La moneda no puede estar vacía' })
  moneda?: string;

  @ApiPropertyOptional({
    description:
      'Efectivo recibido (entradas físicas). Si no se envía se deriva de ventas + recargos - transferencias - créditos',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'El efectivo recibido debe ser un número' })
  @Min(0, { message: 'El efectivo recibido no puede ser negativo' })
  efectivo_recibido?: number;

  @ApiPropertyOptional({
    description: 'Cambio entregado (salida física)',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'El cambio entregado debe ser un número' })
  @Min(0, { message: 'El cambio entregado no puede ser negativo' })
  cambio_entregado?: number;

  @ApiPropertyOptional({
    description: 'Devoluciones en efectivo (salida física)',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Las devoluciones en efectivo deben ser un número' })
  @Min(0, { message: 'Las devoluciones en efectivo no pueden ser negativas' })
  devoluciones_efectivo?: number;

  @ApiPropertyOptional({
    description:
      'Depósitos bancarios (salida física). Si no se envía se suman los depósitos del turno en esa moneda',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Los depósitos bancarios deben ser un número' })
  @Min(0, { message: 'Los depósitos bancarios no pueden ser negativos' })
  depositos_bancarios?: number;

  @ApiPropertyOptional({ description: 'Nombre de quien realiza el cuadre' })
  @IsOptional()
  @IsString({ message: 'realizadoPor debe ser texto' })
  realizadoPor?: string;

  @ApiPropertyOptional({ description: 'Observaciones del cuadre' })
  @IsOptional()
  @IsString({ message: 'Las observaciones deben ser texto' })
  observaciones?: string;
}
