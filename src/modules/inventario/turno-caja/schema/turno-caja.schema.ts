import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TurnoCajaDocument = HydratedDocument<TurnoCaja>;

export enum EstadoTurnoCaja {
  ABIERTO = 'abierto',
  CERRADO = 'cerrado',
}

/**
 * Turno de un cajero (doc §6.6). El fondo inicial es POR MONEDA: la clave es
 * el código de la moneda (`tipo_moneda`, p. ej. CUP o USD) y el valor el monto.
 */
@Schema({ timestamps: true, collection: 'turnos_caja' })
export class TurnoCaja {
  @Prop({ type: Types.ObjectId, ref: 'Usuarios', required: true })
  cajeroId!: Types.ObjectId;

  @Prop()
  cajeroNombre?: string;

  @Prop({ type: Date, required: true, default: Date.now })
  fechaApertura!: Date;

  @Prop({ type: Date })
  fechaCierre?: Date;

  @Prop({ type: Map, of: Number, default: {} })
  fondoInicial!: Map<string, number>;

  @Prop({
    required: true,
    enum: EstadoTurnoCaja,
    default: EstadoTurnoCaja.ABIERTO,
  })
  estado!: EstadoTurnoCaja;

  /** Cuadre operativo del turno (se vincula al crear el cuadre). */
  @Prop({ type: Types.ObjectId, ref: 'CuadreCaja' })
  cuadre?: Types.ObjectId;

  /** Arqueo formal SC-3-06 del turno (se vincula al crear el arqueo). */
  @Prop({ type: Types.ObjectId, ref: 'ArqueoCaja' })
  arqueo?: Types.ObjectId;

  @Prop({ trim: true })
  observacionesCierre?: string;
}

export const TurnoCajaSchema = SchemaFactory.createForClass(TurnoCaja);

// Un cajero solo puede tener un turno abierto (la regla también se valida en
// el servicio; el índice cubre la carrera entre dos aperturas simultáneas).
TurnoCajaSchema.index(
  { cajeroId: 1 },
  {
    unique: true,
    partialFilterExpression: { estado: EstadoTurnoCaja.ABIERTO },
    // Un nombre propio: en una base que ya tiene un `cajeroId_1` simple, el
    // índice único no chocaría con él (mismo patrón, otras opciones).
    name: 'cajeroId_turno_abierto_unico',
  },
);

// Listado de los turnos de un cajero, el más reciente primero.
TurnoCajaSchema.index({ cajeroId: 1, fechaApertura: -1 });

/** Turno tal como lo devuelve la API: el mapa de fondos como objeto plano. */
export interface TurnoCajaPlano {
  _id: Types.ObjectId;
  cajeroId: Types.ObjectId;
  cajeroNombre?: string;
  fechaApertura: Date;
  fechaCierre?: Date;
  fondoInicial: Record<string, number>;
  estado: EstadoTurnoCaja;
  cuadre?: Types.ObjectId;
  arqueo?: Types.ObjectId;
  observacionesCierre?: string;
}
