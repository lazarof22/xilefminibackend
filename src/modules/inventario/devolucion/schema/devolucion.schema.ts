import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DevolucionDocument = HydratedDocument<Devolucion>;

/** Quién devuelve: al cliente (devolución de venta) o al proveedor. */
export enum DevolucionTipo {
  VENTA = 'venta',
  PROVEEDOR = 'proveedor',
}

/** Qué documento de origen referencia el vale (siempre obligatorio). */
export enum DevolucionOrigenTipo {
  VENTA = 'venta',
  FACTURA = 'factura',
  REGISTRO_COMPRA = 'registro_compra',
}

/** Qué se hace con el dinero de una devolución de venta. */
export enum FormaDevolucionDinero {
  EFECTIVO = 'efectivo',
  NOTA_CREDITO = 'nota_credito',
  DESCUENTA_DEUDA = 'descuenta_deuda',
}

/**
 * Ciclo de vida del vale:
 *  - `pendiente`: documento creado, stock aún sin mover.
 *  - `aplicando`: reclamado por `aplicar` (solo una llamada lo consigue).
 *  - `registrada`: stock y kardex aplicados exactamente una vez.
 *  - `fallida`: la aplicación falló y se compensó; no mueve nada ni cuenta
 *    en el acumulado devuelto del origen. Se conserva como evidencia.
 */
export enum EstadoDevolucion {
  PENDIENTE = 'pendiente',
  APLICANDO = 'aplicando',
  REGISTRADA = 'registrada',
  FALLIDA = 'fallida',
}

/** Ubicación física hacia/desde la que se mueve parte de una línea. */
@Schema({ _id: false })
export class UbicacionDevolucion {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Almacen', required: true })
  almacen!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Contenedor',
    required: true,
  })
  contenedor!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  cantidad!: number;
}
const UbicacionDevolucionSchema =
  SchemaFactory.createForClass(UbicacionDevolucion);

@Schema({ _id: false })
export class LineaDevolucion {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Producto',
    required: true,
  })
  producto!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  cantidadSolicitada!: number;

  /** Lo que realmente se recibe/entrega; es lo que mueve el stock. */
  @Prop({ required: true, min: 0 })
  cantidadEntregada!: number;

  /** Precio neto unitario del origen (lo calcula el servidor). */
  @Prop({ required: true, min: 0 })
  precioUnitario!: number;

  /** `precioUnitario × cantidadEntregada` con el impuesto del origen. */
  @Prop({ required: true, min: 0 })
  importe!: number;

  /** Ubicaciones a las que vuelve (o de las que sale) esta línea. */
  @Prop({ type: [UbicacionDevolucionSchema], default: [] })
  ubicaciones!: UbicacionDevolucion[];

  /** Parte de la línea sin ubicación de origen conocida (política por defecto). */
  @Prop({ required: true, min: 0, default: 0 })
  sinUbicacion!: number;
}
const LineaDevolucionSchema = SchemaFactory.createForClass(LineaDevolucion);

@Schema({ _id: false })
export class RegistradoPor {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  nombre!: string;
}

/** Vale de Entrega o Devolución SC-2-08 (doc §6.6 / §7.3). */
@Schema({ timestamps: true, collection: 'devoluciones' })
export class Devolucion {
  @Prop({ required: true, unique: true })
  numeroConsecutivo!: string;

  @Prop({ type: String, required: true, enum: Object.values(DevolucionTipo) })
  tipo!: DevolucionTipo;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(DevolucionOrigenTipo),
  })
  origenTipo!: DevolucionOrigenTipo;

  /** Venta, factura o compra de origen: una devolución siempre lo referencia. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  origenRef!: Types.ObjectId;

  @Prop({ required: true })
  motivo!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Cliente' })
  cliente?: Types.ObjectId;

  @Prop({ type: [LineaDevolucionSchema], required: true })
  lineas!: LineaDevolucion[];

  @Prop({ required: true })
  autorizadoPor!: string;

  @Prop({ required: true })
  recibidoPor!: string;

  /** Evidencia de aceptación. */
  @Prop({ required: true })
  firma!: string;

  /** Solo en devoluciones de venta; una devolución a proveedor no devuelve dinero al cliente. */
  @Prop({ type: String, enum: Object.values(FormaDevolucionDinero) })
  formaDevolucionDinero?: FormaDevolucionDinero;

  /** Importe de la devolución calculado con los precios del origen. */
  @Prop({ required: true, min: 0, default: 0 })
  montoDevuelto!: number;

  @Prop({ required: true, default: 'CUP' })
  moneda!: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(EstadoDevolucion),
    default: EstadoDevolucion.PENDIENTE,
    index: true,
  })
  estado!: EstadoDevolucion;

  @Prop({ type: Date, default: Date.now, index: true })
  fecha!: Date;

  @Prop({ type: RegistradoPor, _id: false })
  registradoPor?: RegistradoPor;

  /** Motivo técnico cuando `estado = fallida`. */
  @Prop()
  errorAplicacion?: string;
}

export const DevolucionSchema = SchemaFactory.createForClass(Devolucion);
DevolucionSchema.index({ formaDevolucionDinero: 1, fecha: -1 });
