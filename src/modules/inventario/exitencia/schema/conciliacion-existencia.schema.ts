import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConciliacionExistenciaDocument =
  HydratedDocument<ConciliacionExistencia>;

export enum EstrategiaConciliacion {
  /** El stock del producto es el correcto: se ajustan las existencias. */
  STOCK_PRODUCTO = 'stock_producto',
  /** Las existencias son las correctas: se ajusta el stock del producto. */
  EXISTENCIAS = 'existencias',
  /** Conteo físico: el administrador indica la cantidad real por ubicación. */
  CONTEO = 'conteo',
}

@Schema({ _id: false })
class CambioUbicacion {
  @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
  almacen!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contenedor', required: true })
  contenedor!: Types.ObjectId;

  @Prop({ required: true })
  antes!: number;

  @Prop({ required: true })
  despues!: number;
}

/**
 * Evidencia de cada resolución de la conciliación: quién, cuándo, con qué
 * criterio y los saldos antes y después (nada cambia sin dejar rastro).
 */
@Schema({ collection: 'conciliaciones_existencia', timestamps: true })
export class ConciliacionExistencia {
  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  producto!: Types.ObjectId;

  @Prop({ required: true, enum: EstrategiaConciliacion })
  estrategia!: EstrategiaConciliacion;

  @Prop({ required: true })
  usuario!: string;

  @Prop()
  observacion?: string;

  @Prop({ required: true })
  stockProductoAntes!: number;

  @Prop({ required: true })
  stockProductoDespues!: number;

  @Prop({ required: true })
  sumaExistenciasAntes!: number;

  @Prop({ required: true })
  sumaExistenciasDespues!: number;

  @Prop({ type: [CambioUbicacion], default: [] })
  cambios!: CambioUbicacion[];
}

export const ConciliacionExistenciaSchema = SchemaFactory.createForClass(
  ConciliacionExistencia,
);
