import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ESTADO_LEGADO_AJUSTADA,
  EstadoFactura,
  FACTURA_CLIENTE_NOMBRE_POR_DEFECTO,
  TipoPago,
} from '../factura.constants';

export type FacturaDocument = HydratedDocument<Factura>;

@Schema({ _id: false })
class ItemFactura {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  productoId!: string;

  @Prop({ required: true })
  productoNombre!: string;

  @Prop()
  unidadMedida?: string;

  @Prop({ required: true })
  cantidad!: number;

  @Prop({ required: true })
  precio!: number;

  @Prop({ required: true })
  costo!: number;

  @Prop({ required: true })
  descuentoPct!: number;

  @Prop({ required: true })
  descuentoMonto!: number;

  @Prop({ required: true })
  recargo!: number;

  @Prop({ required: true })
  total!: number;
}

@Schema({ _id: false })
class Impuesto {
  @Prop()
  tipo?: string;

  @Prop()
  porciento?: number;

  @Prop()
  importe?: number;
}

@Schema({ _id: false })
class EmisorDatos {
  @Prop()
  nombre?: string;

  @Prop()
  nit?: string;

  @Prop()
  direccion?: string;

  @Prop()
  telefono?: string;

  @Prop()
  email?: string;

  @Prop()
  reeup?: string;

  @Prop()
  numeroCuenta?: string;

  @Prop()
  sucursalBancaria?: string;

  @Prop()
  registroComercial?: string;

  @Prop()
  ciudad?: string;

  @Prop()
  pais?: string;
}

/**
 * "Despachado por" / "Transportado por" / "Recibido por" (T3, spec "TABLA
 * DE UNA FACTURA", signatures excluded). Free data (name, CI, date), not
 * system users: there's no `almacenero` role, so these three are never
 * resolved from a logged-in account.
 */
@Schema({ _id: false })
class ParticipanteFactura {
  @Prop({ required: true })
  nombre!: string;

  @Prop({ required: true })
  ci!: string;

  @Prop({ required: true })
  fecha!: string;
}

/**
 * "Facturado por" (T4, spec "TABLA DE UNA FACTURA", signature excluded):
 * snapshot of the authenticated Facturador user at creation time. Unlike
 * `ParticipanteFactura`, this one *is* a system user, so it carries an
 * `empleadoId` reference in addition to the name/CI/date snapshot (kept
 * even if the employee is later renamed or removed). Optional on the
 * schema so legacy invoices (created before this field existed) still
 * load; always set for new invoices (`FacturaService.create`).
 */
@Schema({ _id: false })
class FacturadorFactura {
  @Prop({ type: Types.ObjectId, ref: 'Usuario', required: true })
  empleadoId!: Types.ObjectId;

  @Prop({ required: true })
  nombre!: string;

  @Prop({ required: true })
  ci!: string;

  @Prop({ required: true })
  fecha!: string;
}

@Schema({ timestamps: true, id: false })
export class Factura {
  @Prop({ required: true, unique: true })
  id!: string;

  @Prop({ required: true, unique: true })
  numero!: number;

  @Prop({ required: true })
  fecha!: string;

  @Prop({ required: true, default: FACTURA_CLIENTE_NOMBRE_POR_DEFECTO })
  cliente!: string;

  @Prop({ default: '' })
  nit?: string;

  @Prop({ default: '' })
  direccion?: string;

  @Prop({ default: '' })
  telefono?: string;

  @Prop({ default: '' })
  email?: string;

  @Prop({ required: true, default: 'CUP' })
  moneda!: string;

  @Prop()
  concepto?: string;

  @Prop({ type: Types.ObjectId, ref: 'Cliente' })
  clienteId?: Types.ObjectId;

  // Both optional so legacy invoices (created before this field existed)
  // still load; always set for new invoices (FacturaService.create).
  // almacenCodigo is a snapshot (not a live lookup) so the invoice keeps
  // showing the code that was valid at emission time, even if the
  // almacén's codigo changes later.
  @Prop({ type: Types.ObjectId, ref: 'Almacen' })
  almacenId?: Types.ObjectId;

  @Prop()
  almacenCodigo?: string;

  @Prop({ type: EmisorDatos, _id: false })
  emisor?: EmisorDatos;

  @Prop({ type: Impuesto, _id: false })
  impuesto?: Impuesto;

  @Prop({ type: String, required: true, enum: Object.values(TipoPago) })
  metodoPago!: TipoPago;

  // Free-text receipt-book reference (T6b, spec: "Terminada: se le pueden
  // modificar la fecha o el talonario"). Optional so legacy invoices
  // (created before this field existed) still load.
  @Prop()
  talonario?: string;

  @Prop({ type: [ItemFactura], required: true })
  items!: ItemFactura[];

  @Prop({ required: true })
  subtotal!: number;

  @Prop({ required: true })
  descuentoTotal!: number;

  @Prop({ required: true })
  recargoTotal!: number;

  @Prop({ required: true })
  total!: number;

  // Legacy 'ajustada' documents are migrated to 'confirmada' in
  // FacturaService.onModuleInit before this enum can reject them on a
  // later write (see factura-estado.ts for the transitions).
  @Prop({
    type: String,
    required: true,
    enum: Object.values(EstadoFactura),
    default: EstadoFactura.EDICION,
  })
  estado!: EstadoFactura;

  @Prop({
    required: true,
    enum: ['factura_normal', 'ajuste'],
    default: 'factura_normal',
  })
  tipo!: string;

  @Prop({ required: true, default: false })
  impreso!: boolean;

  @Prop({ type: ParticipanteFactura, _id: false })
  despachadoPor?: ParticipanteFactura;

  @Prop({ type: ParticipanteFactura, _id: false })
  transportadoPor?: ParticipanteFactura;

  @Prop({ type: ParticipanteFactura, _id: false })
  recibidoPor?: ParticipanteFactura;

  // Server-controlled (T4): never accepted from CreateFacturaDto /
  // UpdateFacturaDto, always taken from the authenticated JWT user in
  // FacturaService.create.
  @Prop({ type: FacturadorFactura, _id: false })
  facturadoPor?: FacturadorFactura;

  // Preserves the pre-migration value (T6b, carried over from a T6a
  // review finding): FacturaService.migrarEstadoAjustada normalizes a
  // legacy `estado: 'ajustada'` to `confirmada` so it passes the
  // EstadoFactura enum, but that would otherwise lose the fact the
  // invoice was originally 'ajustada'. Never set for invoices that were
  // never 'ajustada'.
  @Prop({ type: String, enum: [ESTADO_LEGADO_AJUSTADA] })
  estadoLegado?: typeof ESTADO_LEGADO_AJUSTADA;

  // Optimistic concurrency counter (T6c, fixes the lost-update race in
  // `edicion`: two concurrent PATCHes both reading the same `estado` could
  // otherwise both match the same conditional `findOneAndUpdate` and one
  // would silently overwrite the other's derived fields). Incremented by
  // every `FacturaService.update` and `transicionar` call; `update`'s
  // conditional write also matches the `revision` it read, so a write that
  // lands between another update's read and write never matches and is
  // disambiguated into a 409 instead of being lost.
  //
  // Deliberately has NO schema `default`: a `default` would make Mongoose
  // backfill it to 0 in memory even for a document whose stored bytes have
  // no `revision` field at all (verified empirically), which would make a
  // truly legacy document (persisted before this field existed)
  // indistinguishable from a `revision: 0` document and break the
  // `{ revision: { $exists: false } }` legacy-match branch in `update`.
  // New invoices always get an explicit `revision: 0` from
  // `FacturaService.create`.
  @Prop({ type: Number })
  revision?: number;

  // Inventory bookkeeping (T7). `inventarioAplicado` is true only when
  // `FacturaService.confirmar` decreased stock for this invoice; legacy
  // `confirmada` invoices never carry it, so cancelling them never adds
  // stock back. `inventarioRevertido` records (audit) that `cancelar`
  // restored that stock. `inventarioEnProceso` (T7b) is set while
  // `confirmar` or `cancelar` is moving stock and cleared in the same write
  // that finalizes it; `cancelar` refuses to claim while it is set. A crash
  // mid-movement leaves it set (see README). No defaults: absent means "no".
  @Prop({ type: Boolean })
  inventarioAplicado?: boolean;

  @Prop({ type: Boolean })
  inventarioRevertido?: boolean;

  @Prop({ type: Boolean })
  inventarioEnProceso?: boolean;
}

export const FacturaSchema = SchemaFactory.createForClass(Factura);
