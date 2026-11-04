import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsObject, IsString } from 'class-validator';

export class CreateArqueoCajaDto {
  @ApiProperty({ description: 'Turno de caja que se arquea' })
  @IsMongoId()
  turnoCajaId!: string;

  @ApiProperty({ description: 'Quien cuenta el efectivo' })
  @IsString()
  @IsNotEmpty()
  responsableArqueo!: string;

  @ApiProperty({ description: 'Quien custodia el efectivo (jefe de caja)' })
  @IsString()
  @IsNotEmpty()
  responsableCustodia!: string;

  @ApiProperty({
    description:
      'Efectivo contado por moneda: código -> { contado, denominaciones? }. El esperado y la diferencia los calcula el servidor.',
    example: {
      CUP: { contado: 7600, denominaciones: { '500': 10, '100': 26 } },
    },
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  efectivoContado!: Record<
    string,
    { contado: number; denominaciones?: Record<string, number> }
  >;

  @ApiProperty({ description: 'Observaciones del arqueo' })
  @IsString()
  @IsNotEmpty()
  observaciones!: string;

  @ApiProperty({ description: 'Quien firma el arqueo (evidencia)' })
  @IsString()
  @IsNotEmpty()
  firmadoPor!: string;
}
