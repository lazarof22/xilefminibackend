import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ArqueoCajaDocument = HydratedDocument<ArqueoCaja>;

/** Efectivo de UNA moneda en el arqueo. */
export interface EfectivoArqueoMoneda {
  esperado: number;
  contado: number;
  /** Denominación -> cantidad de billetes/monedas contados (opcional). */
  denominaciones?: Record<string, number>;
}

export type EstadoDiferencia = 'cuadrado' | 'sobrante' | 'faltante';

/** Diferencia (contado − esperado) de UNA moneda; nunca se suma entre monedas. */
export interface DiferenciaArqueoMoneda {
  monto: number;
  estado: EstadoDiferencia;
}

/**
 * Arqueo de caja SC-3-06 (Res. 12/2007): comprobación FORMAL del efectivo,
 * documento separado del cuadre operativo. Esperado, contado y diferencia van
 * POR MONEDA (clave: código de moneda).
 */
@Schema({ timestamps: true, collection: 'arqueos_caja' })
export class ArqueoCaja {
  @Prop({
    type: Types.ObjectId,
    ref: 'TurnoCaja',
    required: true,
    unique: true,
  })
  turnoCajaId!: Types.ObjectId;

  /** Quien cuenta. */
  @Prop({ required: true, trim: true })
  responsableArqueo!: string;

  /** Quien custodia (jefe de caja). */
  @Prop({ required: true, trim: true })
  responsableCustodia!: string;

  @Prop({ type: Map, of: Object, default: {} })
  efectivoContado!: Map<string, EfectivoArqueoMoneda>;

  @Prop({ type: Map, of: Object, default: {} })
  diferencia!: Map<string, DiferenciaArqueoMoneda>;

  /** true cuando quien cuenta es el mismo cajero del turno (la norma puede exigir otro). */
  @Prop({ required: true, default: false })
  mismoResponsableQueCajero!: boolean;

  @Prop({ required: true, trim: true })
  observaciones!: string;

  /** Evidencia: quien firma el documento. */
  @Prop({ required: true, trim: true })
  firmadoPor!: string;

  @Prop({ type: Types.ObjectId, ref: 'Usuarios' })
  creadoPor?: Types.ObjectId;
}

export const ArqueoCajaSchema = SchemaFactory.createForClass(ArqueoCaja);

/** Arqueo tal como lo devuelve la API (mapas como objetos). */
export interface ArqueoCajaPlano {
  _id: Types.ObjectId;
  turnoCajaId: Types.ObjectId;
  responsableArqueo: string;
  responsableCustodia: string;
  efectivoContado: Record<string, EfectivoArqueoMoneda>;
  diferencia: Record<string, DiferenciaArqueoMoneda>;
  mismoResponsableQueCajero: boolean;
  observaciones: string;
  firmadoPor: string;
  creadoPor?: Types.ObjectId;
  createdAt?: Date;
}
