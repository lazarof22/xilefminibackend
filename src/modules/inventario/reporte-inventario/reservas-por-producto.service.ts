import { Injectable } from '@nestjs/common';

/**
 * Cantidad de unidades reservadas de cada producto.
 *
 * PENDIENTE (módulo de facturación): las reservas dependen de las facturas y
 * ese trabajo lo lleva otro programador del equipo. Mientras tanto no hay
 * reservas y todos los productos devuelven 0.
 *
 * Es el ÚNICO punto que hay que completar para que el reporte muestre
 * reservados reales: debe devolver un mapa `productoId (hex de 24 caracteres)
 * -> unidades reservadas`. Los productos que no aparezcan en el mapa cuentan
 * como 0. El reporte, el endpoint y el cálculo del inventario total no
 * necesitan cambios.
 */
@Injectable()
export class ReservasPorProductoService {
  obtenerPorProducto(): Promise<Map<string, number>> {
    return Promise.resolve(new Map<string, number>());
  }
}
