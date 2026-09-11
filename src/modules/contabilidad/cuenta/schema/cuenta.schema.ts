import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum NaturalezaCuenta {
  DEUDORA = 'Deudora',
  ACREDORA = 'Acreedora',
}

/**
 * Grupo contable (clasificador mayor).
 * Es un enum fijo y NO un nomenclador: el catálogo no cambia en runtime.
 * Convención sugerida por el Word de anotaciones:
 *   - 1xx  Activo
 *   - 2xx  Pasivo
 *   - 3xx  Capital o Patrimonio
 *   - 4xx–5xx  Gastos
 *   - 6xx–7xx  Ingresos
 *   - 8xx–9xx  Cuentas de cierre
 */
export enum GrupoCuenta {
  ACTIVO = 'Activo',
  PASIVO = 'Pasivo',
  CAPITAL = 'Capital o Patrimonio',
  GASTOS = 'Gastos',
  INGRESOS = 'Ingresos',
  CIERRE = 'Cuenta de Cierre',
}

export type CuentaDocument = HydratedDocument<Cuenta>;

@Schema({ timestamps: true })
export class Cuenta {
  @Prop({ required: true, unique: true })
  codigo!: string;

  @Prop({ required: true })
  nombre!: string;

  @Prop({ required: true, enum: NaturalezaCuenta })
  naturaleza!: NaturalezaCuenta;

  @Prop({ type: Types.ObjectId, ref: 'Cuenta', default: null })
  padre?: Types.ObjectId | null;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Moneda' })
  moneda!: Types.ObjectId;

  @Prop({ required: true, default: 1 })
  nivel!: number;

  @Prop()
  denominacion?: string;

  @Prop({ enum: GrupoCuenta })
  grupo?: GrupoCuenta;

  @Prop()
  partida?: string;

  @Prop()
  elemento?: string;

  @Prop()
  descripcion?: string;
}

export const CuentaSchema = SchemaFactory.createForClass(Cuenta);
