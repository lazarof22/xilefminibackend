import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CuadreCajaDocument = HydratedDocument<CuadreCaja>;

@Schema({ _id: false })
export class DesgloseBilletes {
  @Prop({ required: true, default: 0 })
  billete5000!: number;

  @Prop({ required: true, default: 0 })
  billete2000!: number;

  @Prop({ required: true, default: 0 })
  billete1000!: number;

  @Prop({ required: true, default: 0 })
  billete500!: number;

  @Prop({ required: true, default: 0 })
  billete200!: number;

  @Prop({ required: true, default: 0 })
  billete100!: number;

  @Prop({ required: true, default: 0 })
  billete50!: number;

  @Prop({ required: true, default: 0 })
  billete20!: number;

  @Prop({ required: true, default: 0 })
  billete10!: number;

  @Prop({ required: true, default: 0 })
  billete5!: number;

  @Prop({ required: true, default: 0 })
  billete3!: number;

  @Prop({ required: true, default: 0 })
  billete1!: number;
}

@Schema({ _id: false })
export class OtroMotivo {
  @Prop({ required: true })
  concepto!: string;

  @Prop({ required: true, min: 0 })
  monto!: number;

  @Prop({ required: true, enum: ['ingreso', 'egreso'] })
  tipo!: string;
}

@Schema({ timestamps: true })
export class CuadreCaja {
  @Prop({ type: Date, default: Date.now })
  fecha!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Usuario', required: true })
  empleado!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  creditos!: number;

  @Prop({ required: true, min: 0 })
  total_ventas_dia!: number;

  @Prop({ required: true, min: 0 })
  total_extracciones_dia!: number;

  @Prop({ required: true, type: DesgloseBilletes })
  desglose_billetes!: DesgloseBilletes;

  @Prop({ required: true, min: 0 })
  valor_transferencias!: number;

  @Prop({ required: true, min: 0 })
  recargos!: number;

  /**
   * Corrección (en CUP) por las ventas en efectivo cobradas o devueltas en otra
   * moneda: el total de esas ventas no entró en CUP. Puede ser negativa.
   */
  @Prop({ required: true, default: 0 })
  ajuste_divisas!: number;

  @Prop({ required: true, min: 0 })
  descuentos!: number;

  @Prop({ type: [OtroMotivo], default: [] })
  otros_motivos!: OtroMotivo[];

  @Prop({ required: true, min: 0 })
  total_efectivo!: number;

  /**
   * Lo que debería haber en la caja de pesos según las ventas del día. Puede ser
   * negativo: con ventas cobradas en otra moneda el cambio sale de la caja de
   * pesos y puede ser mayor que lo que entró (hasta que el turno registre el
   * fondo con el que se abrió la caja).
   */
  @Prop({ required: true, default: 0 })
  efectivo_esperado!: number;

  @Prop({ required: true, default: 0 })
  diferencia!: number;

  @Prop({
    required: true,
    enum: ['cuadrado', 'diferencia'],
    default: 'cuadrado',
  })
  estado!: string;

  @Prop({ trim: true })
  realizadoPor?: string;

  @Prop({ trim: true })
  observaciones?: string;
}

export const CuadreCajaSchema = SchemaFactory.createForClass(CuadreCaja);
