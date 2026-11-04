import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class AbrirTurnoCajaDto {
  @ApiProperty({
    description:
      'Fondo inicial por moneda: código de la moneda -> monto (p. ej. { "CUP": 5000, "USD": 20 })',
    example: { CUP: 5000, USD: 20 },
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  @IsObject()
  fondoInicial!: Record<string, number>;
}
