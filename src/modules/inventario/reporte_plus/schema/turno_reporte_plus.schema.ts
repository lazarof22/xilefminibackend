import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { DetalleEfectivoMoneda } from '../efectivo-turno.util';

export type TurnoReportePlusDocument = HydratedDocument<TurnoReportePlus>;

@Schema({ _id: false })
export class TotalesPorMetodo {
  @Prop({ default: 0 }) efectivo!: number;
  @Prop({ default: 0 }) credito!: number;
  @Prop({ default: 0 }) transferencia!: number;
  @Prop({ default: 0 }) factura!: number;
}

/**
 * Historial de turnos cerrados: el resumen se guarda antes de vaciar las
 * filas del Reporte Plus, así los totales no se pierden.
 */
@Schema({ timestamps: true, collection: 'turnos_reporte_plus' })
export class TurnoReportePlus {
  @Prop({ required: true }) desde!: Date;
  @Prop({ required: true, index: true }) cierre!: Date;
  @Prop({ required: true }) totalVentas!: number;
  @Prop({ required: true }) totalExtracciones!: number;
  /** @deprecated mezcla efectivo, crédito y transferencia; usar las cifras por moneda. */
  @Prop({ required: true }) saldoNeto!: number;
  @Prop({ required: true }) cantidadTransferencias!: number;
  @Prop({ required: true }) movimientos!: number;
  @Prop({ type: TotalesPorMetodo, required: true })
  porMetodo!: TotalesPorMetodo;

  /** Cifras separadas por moneda (clave = código de moneda). */
  @Prop({ type: Object }) efectivoEsperado?: Record<string, number>;
  @Prop({ type: Object }) cuentasPorCobrar?: Record<string, number>;
  @Prop({ type: Object }) cobrosElectronicos?: Record<string, number>;
  @Prop({ type: Object }) facturado?: Record<string, number>;
  @Prop({ type: Object }) detalleEfectivo?: Record<
    string,
    DetalleEfectivoMoneda
  >;
}

export const TurnoReportePlusSchema =
  SchemaFactory.createForClass(TurnoReportePlus);
