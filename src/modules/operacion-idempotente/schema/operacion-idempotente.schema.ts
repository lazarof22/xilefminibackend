import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OperacionIdempotenteDocument =
  HydratedDocument<OperacionIdempotente>;

export enum EstadoOperacion {
  /** Se está ejecutando (o se cayó a mitad y espera a la recuperación). */
  EN_PROCESO = 'en_proceso',
  /** Terminó bien: `respuesta` es lo que se devuelve a cualquier reintento. */
  COMPLETADA = 'completada',
  /** Falló y quedó todo deshecho: un reintento con la misma clave la vuelve a ejecutar. */
  FALLIDA = 'fallida',
  /** Quedó algo dudoso que solo una persona puede decidir (ver `motivoRevision`). */
  REVISION = 'revision',
}

/** Un asiento del registro de pasos. Solo se añaden, nunca se editan ni se borran. */
export interface PasoOperacion {
  /** Número de ejecución de la operación (sube en cada reintento tras una falla). */
  intento: number;
  /** Qué parte de la operación: `stock`, `plan`, `confirmacion`, `operacion`... */
  paso: string;
  /** Qué ocurrió: `iniciado`, `hecho`, `revertido`, `fallido`, `fallida`... */
  evento: string;
  /** Línea del documento a la que se refiere (p. ej. la línea de la venta). */
  linea?: number;
  datos?: Record<string, unknown>;
  fecha: Date;
}

export interface ErrorOperacion {
  codigoHttp: number;
  /** El cuerpo exacto de la respuesta de error, para repetirlo igual. */
  cuerpo: unknown;
}

/**
 * Registro de una operación con clave de idempotencia (`Idempotency-Key`).
 *
 * Sirve para tres cosas a la vez:
 *  1. Evitar duplicados: el índice único sobre `clave` hace que dos peticiones
 *     con la misma clave nunca se ejecuten dos veces; la segunda recibe la
 *     respuesta guardada (o espera a que la primera termine).
 *  2. Detectar abusos: la `huella` del cuerpo impide reutilizar una clave con
 *     datos distintos.
 *  3. Recuperar tras una caída: MongoDB autónomo no tiene transacciones, así
 *     que la operación escribe aquí su `plan` y un registro de `pasos` ANTES
 *     de cada escritura. Si el servidor se cae, al arrancar se lee este
 *     registro y se completa o se revierte lo que quedó a medias, sin borrar
 *     nada (los asientos solo se añaden).
 *
 * `plan`, `respuesta` y `pasos[].datos` son libres: cada tipo de operación
 * guarda lo suyo (el checkout, su plan de venta).
 */
@Schema({ collection: 'operaciones_idempotentes', timestamps: true })
export class OperacionIdempotente {
  @Prop({ required: true })
  clave!: string;

  /** Tipo de operación (`venta.checkout`): una clave no sirve para dos tipos. */
  @Prop({ required: true })
  ambito!: string;

  /** SHA-256 del cuerpo canónico de la petición. */
  @Prop({ required: true })
  huella!: string;

  @Prop({ required: true })
  usuarioId!: string;

  @Prop({
    required: true,
    enum: EstadoOperacion,
    default: EstadoOperacion.EN_PROCESO,
  })
  estado!: EstadoOperacion;

  /**
   * Token de quien ejecuta la operación AHORA. Toda escritura del registro lo
   * exige: si la recuperación toma la operación, el ejecutor original deja de
   * poder escribir y no sigue tocando datos.
   */
  @Prop({ required: true })
  propietario!: string;

  /** Hasta cuándo es suya (arrendamiento). Pasado ese momento, la recuperación puede tomarla. */
  @Prop({ type: Date, required: true })
  vence!: Date;

  @Prop({ required: true, default: 1 })
  intentos!: number;

  @Prop({ required: true, default: 0 })
  recuperaciones!: number;

  @Prop({ type: Object })
  plan?: Record<string, unknown>;

  /** Punto de no retorno: pasada esta marca la operación solo se completa, no se revierte. */
  @Prop({ required: true, default: false })
  confirmando!: boolean;

  @Prop({ type: [Object], default: [] })
  pasos!: PasoOperacion[];

  @Prop({ type: Number })
  codigoHttp?: number;

  @Prop({ type: Object })
  respuesta?: Record<string, unknown>;

  @Prop({ type: Object })
  error?: ErrorOperacion;

  @Prop()
  motivoRevision?: string;

  @Prop({ type: Date })
  finalizadaEn?: Date;
}

export const OperacionIdempotenteSchema =
  SchemaFactory.createForClass(OperacionIdempotente);

OperacionIdempotenteSchema.index({ clave: 1 }, { unique: true });
// La recuperación busca las que siguen en proceso y ya vencieron.
OperacionIdempotenteSchema.index({ estado: 1, vence: 1 });
