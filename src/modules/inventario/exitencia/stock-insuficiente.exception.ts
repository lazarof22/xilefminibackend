import { BadRequestException } from '@nestjs/common';

/**
 * No hay stock suficiente para el movimiento pedido. Lleva los números para
 * que quien llama (factura, venta, kardex) pueda armar su propio mensaje.
 */
export class StockInsuficienteException extends BadRequestException {
  constructor(
    readonly producto: string,
    readonly disponible: number,
    readonly solicitado: number,
    ubicacion?: string,
  ) {
    super(
      `Stock insuficiente para ${producto}${ubicacion ? ` ${ubicacion}` : ''}: disponible ${disponible}, solicitado ${solicitado}`,
    );
  }
}
