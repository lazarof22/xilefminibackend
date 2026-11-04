import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RecepcionDocument = HydratedDocument<Recepcion>;

/** Ciclo de vida: el saldo solo se mueve al pasar de `borrador` a `registrada`. */
export enum EstadoRecepcion {
  BORRADOR = 'borrador',
  REGISTRADA = 'registrada',
}

export enum TipoDocumentoOrigen {
  FACTURA = 'factura',
  CONDUCE = 'conduce',
  OTRO = 'otro',
}

/** Entidad que recibe (copia de los datos de la empresa al crear el borrador). */
@Schema({ _id: false })
export class EntidadReceptora {
  @Prop({ required: true, trim: true })
  codigo!: string;

  @Prop({ required: true, trim: true })
  nombre!: string;
}
export const EntidadReceptoraSchema =
  SchemaFactory.createForClass(EntidadReceptora);

/** Factura, conduce u otro documento que ampara los productos recibidos. */
@Schema({ _id: false })
export class DocumentoOrigen {
  @Prop({ required: true, enum: TipoDocumentoOrigen })
  tipo!: TipoDocumentoOrigen;

  @Prop({ required: true, trim: true })
  numero!: string;

  @Prop({ type: Date, required: true })
  fecha!: Date;
}
export const DocumentoOrigenSchema =
  SchemaFactory.createForClass(DocumentoOrigen);

/** Línea con la misma forma que un `RegistroCompra`; el almacén es el receptor. */
@Schema({ _id: false })
export class LineaRecepcion {
  @Prop({ type: Types.ObjectId, ref: 'Producto', required: true })
  producto!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contenedor', required: true })
  contenedor!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  cantidad!: number;

  @Prop({ required: true, min: 0 })
  costo_unitario!: number;

  /** cantidad × costo_unitario. Lo calcula el servidor. */
  @Prop({ required: true, min: 0 })
  total!: number;
}
export const LineaRecepcionSchema =
  SchemaFactory.createForClass(LineaRecepcion);

/**
 * Informe de Recepción SC-2-04 (doc §6.2): envuelve líneas de compra y añade
 * la cabecera normativa. Queda vinculado a su documento de origen y el saldo
 * del inventario se actualiza AL REGISTRAR, no al crear el borrador.
 */
@Schema({ timestamps: true, collection: 'recepciones' })
export class Recepcion {
  @Prop({ required: true, unique: true })
  numeroConsecutivo!: string;

  @Prop({ type: Date, required: true, default: Date.now })
  fechaEmision!: Date;

  @Prop({ type: EntidadReceptoraSchema, required: true })
  entidadReceptora!: EntidadReceptora;

  @Prop({ type: Types.ObjectId, ref: 'Almacen', required: true })
  almacenReceptor!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Proveedor', required: true })
  proveedor!: Types.ObjectId;

  @Prop({ type: DocumentoOrigenSchema, required: true })
  documentoOrigen!: DocumentoOrigen;

  @Prop({ trim: true })
  transportista?: string;

  @Prop({ type: [LineaRecepcionSchema], required: true })
  lineas!: LineaRecepcion[];

  /** Suma de los totales de línea; lo calcula el servidor. */
  @Prop({ required: true, min: 0 })
  total!: number;

  /** Usuario logueado que crea el documento. */
  @Prop({ required: true, trim: true })
  responsableRecepcion!: string;

  @Prop({ required: true, trim: true })
  responsableComprobacion!: string;

  @Prop({
    required: true,
    enum: EstadoRecepcion,
    default: EstadoRecepcion.BORRADOR,
  })
  estado!: EstadoRecepcion;

  /** true cuando el saldo ya se movió (se fija de forma atómica al registrar). */
  @Prop({ required: true, default: false })
  inventarioAplicado!: boolean;

  @Prop({ type: Date })
  fechaRegistro?: Date;

  @Prop({ trim: true })
  registradoPor?: string;
}

export const RecepcionSchema = SchemaFactory.createForClass(Recepcion);

RecepcionSchema.index({ estado: 1, fechaEmision: -1 });
