import { Types } from 'mongoose';
import { aObjectId } from '../../exitencia/existencia.types';
import type { UbicacionCantidad } from '../../exitencia/existencia.types';
import type { PagoCheckoutPreparado } from '../../pago/pago.service';
import type { PasoOperacion } from '../../../operacion-idempotente/schema/operacion-idempotente.schema';
import type { LineaCalculada, TotalesVenta } from './checkout-totales';

/** Tipo de operación con el que el checkout se registra en `operaciones_idempotentes`. */
export const AMBITO_CHECKOUT = 'venta.checkout';

/**
 * Cuerpo de error con el mismo formato que las excepciones de Nest más un
 * `codigo` estable, para que la pantalla distinga los casos sin leer el texto.
 */
export const cuerpoError = (
  statusCode: number,
  error: string,
  message: string,
  codigo: string,
) => ({ statusCode, error, message, codigo });

export interface LineaPlan extends LineaCalculada {
  stockMinimo?: number;
  /** `_id` del asiento de Kardex y de la fila de Reporte Plus: fijados de antemano para poder repetir el paso sin duplicar. */
  kardexId: Types.ObjectId;
  reporteId: Types.ObjectId;
}

/**
 * Todo lo que el checkout va a hacer, decidido ANTES de tocar nada y guardado
 * en la operación. Si el servidor se cae, la recuperación lo lee y sabe qué
 * documentos crear (con qué `_id`) o qué stock devolver.
 */
export interface PlanCheckout {
  version: 1;
  fecha: Date;
  /** Modo de inventario con el que se descuenta (se fija al empezar). */
  unificado: boolean;
  usuario: { id: string; nombre: string; rol: string };
  clienteId?: Types.ObjectId;
  clienteNombre?: string;
  origen: { almacenId?: string; contenedorId?: string };
  lineas: LineaPlan[];
  totales: TotalesVenta;
  pago: PagoCheckoutPreparado;
  ventaId: Types.ObjectId;
  pagoId: Types.ObjectId;
  advertencias: string[];
}

export interface ItemRespuesta {
  productoId: string;
  codigo: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPct: number;
  /** Precio × cantidad, antes del descuento. */
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
  /** Lo que queda del producto tras esta venta. */
  stockRestante: number;
}

/** Lo que devuelve POST /venta/checkout: siempre los totales DEL SERVIDOR. */
export interface RespuestaCheckout {
  venta: {
    _id: string;
    comprobante: string;
    fecha: string;
    clienteId?: string;
    clienteNombre?: string;
    items: ItemRespuesta[];
    subtotal: number;
    descuento: number;
    impuestoPorciento: number;
    impuesto: number;
    total: number;
  };
  pago: {
    _id: string;
    tipo: string;
    montoRecibido: number;
    cambio: number;
    esCuentaCasa: boolean;
  };
  cambio: number;
  comprobante: string;
  advertencias: string[];
  idempotencia: {
    clave: string;
    estado: 'completada';
    repetida: boolean;
  };
}

/** Resultado de descontar una línea, tal como quedó anotado en el registro de pasos. */
export interface ResultadoLinea {
  stockFinal: number;
  ubicaciones: UbicacionCantidad[];
}

export interface EstadoLineaStock {
  /**
   * `iniciado` y `revirtiendo` son los asientos "antes de escribir": si son el
   * último de una línea, no se sabe si la escritura llegó a ejecutarse.
   */
  evento: 'iniciado' | 'hecho' | 'fallido' | 'revirtiendo' | 'revertido';
  resultado?: ResultadoLinea;
}

const aUbicaciones = (valor: unknown): UbicacionCantidad[] => {
  if (!Array.isArray(valor)) return [];

  return valor.flatMap((u) => {
    const fila = u as {
      almacen?: unknown;
      contenedor?: unknown;
      cantidad?: unknown;
    };
    const almacen = aObjectId(fila.almacen);
    const contenedor = aObjectId(fila.contenedor);
    const cantidad = Number(fila.cantidad);

    return almacen && contenedor && Number.isFinite(cantidad)
      ? [{ almacen, contenedor, cantidad }]
      : [];
  });
};

/**
 * Lee el registro de pasos y dice en qué quedó el stock de cada línea en la
 * ejecución `intento`: el último asiento de cada línea manda. Es lo que usa la
 * recuperación para decidir qué devolver.
 */
export function estadoDeStock(
  pasos: PasoOperacion[],
  intento: number,
): Map<number, EstadoLineaStock> {
  const estados = new Map<number, EstadoLineaStock>();

  for (const paso of pasos) {
    if (
      paso.paso !== 'stock' ||
      paso.intento !== intento ||
      paso.linea === undefined
    ) {
      continue;
    }

    if (paso.evento === 'hecho') {
      estados.set(paso.linea, {
        evento: 'hecho',
        resultado: {
          stockFinal: Number(paso.datos?.stockFinal) || 0,
          ubicaciones: aUbicaciones(paso.datos?.ubicaciones),
        },
      });
    } else if (
      paso.evento === 'iniciado' ||
      paso.evento === 'fallido' ||
      paso.evento === 'revirtiendo' ||
      paso.evento === 'revertido'
    ) {
      const anterior = estados.get(paso.linea);
      estados.set(paso.linea, {
        evento: paso.evento,
        // Al revertir se conserva lo que se había descontado, para el rastro.
        ...(anterior?.resultado ? { resultado: anterior.resultado } : {}),
      });
    }
  }

  return estados;
}

const aId = (valor: unknown): Types.ObjectId => {
  const id = aObjectId(valor);
  if (!id) throw new Error('Plan de checkout con un id no válido');
  return id;
};

const aIdOpcional = (valor: unknown): Types.ObjectId | undefined =>
  valor === undefined || valor === null ? undefined : aId(valor);

/**
 * El plan se guarda en la base como documento libre: al leerlo se vuelven a
 * dejar como ObjectId y Date los campos que lo necesitan, venga como venga.
 */
export function leerPlan(bruto: unknown): PlanCheckout | undefined {
  if (!bruto || typeof bruto !== 'object') return undefined;

  const plan = bruto as PlanCheckout;
  if (plan.version !== 1 || !Array.isArray(plan.lineas)) return undefined;

  return {
    ...plan,
    fecha: new Date(plan.fecha),
    clienteId: aIdOpcional(plan.clienteId),
    ventaId: aId(plan.ventaId),
    pagoId: aId(plan.pagoId),
    lineas: plan.lineas.map((l) => ({
      ...l,
      productoId: aId(l.productoId),
      kardexId: aId(l.kardexId),
      reporteId: aId(l.reporteId),
    })),
    pago: {
      ...plan.pago,
      documento: {
        ...plan.pago.documento,
        ...(plan.pago.documento.clienteId
          ? { clienteId: aId(plan.pago.documento.clienteId) }
          : {}),
      },
    },
  };
}
