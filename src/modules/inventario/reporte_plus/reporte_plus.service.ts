import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { MetodoPagoReporte, ReportePlus } from './schema/reporte_plus.schema';
import { TurnoReportePlus } from './schema/turno_reporte_plus.schema';
import { LineaReportePlus } from './dto/registrar-venta-reporte.dto';
import {
  CierreTurnoResultado,
  ResumenReportePlus,
  TotalesMetodo,
} from './dto/resumen-reporte-plus.dto';

/** Redondeo a 2 decimales (evita 0.1 + 0.2 = 0.30000000000000004). */
const redondear = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

type FilaReporte = Pick<
  ReportePlus,
  | 'fecha'
  | 'productoId'
  | 'cantidadVendida'
  | 'stockFinal'
  | 'metodoPago'
  | 'total'
  | 'referencia'
  | 'enKardex'
>;

/**
 * Reporte Plus: ventas del turno actual.
 *
 * Cerrar turno (MongoDB local sin réplica => sin transacciones):
 *  1. Se "reclaman" las filas abiertas con un id de turno (un solo updateMany
 *     atómico). Las ventas que lleguen durante el cierre quedan sin marca y
 *     pertenecen al turno siguiente: nunca se borra una venta sin pasar al Kardex.
 *  2. Se escribe el Kardex y se guarda el resumen del turno.
 *  3. Si algo falla antes de borrar, se compensa (borra lo escrito en Kardex y
 *     libera las filas) y no se pierde nada.
 *  4. Solo entonces se eliminan las filas reclamadas.
 */
@Injectable()
export class ReportePlusService {
  private readonly logger = new Logger(ReportePlusService.name);

  constructor(
    @InjectModel(ReportePlus.name) private reportePlusModel: Model<ReportePlus>,
    @InjectModel(TurnoReportePlus.name)
    private turnoModel: Model<TurnoReportePlus>,
    @InjectModel(Kardex.name) private kardexModel: Model<Kardex>,
    @InjectModel(Extraccion.name) private extraccionModel: Model<Extraccion>,
  ) {}

  /** Filas abiertas (las que aún no reclamó ningún cierre). */
  private readonly abiertas = { turnoCierre: { $exists: false } };

  async registrarLineas(lineas: LineaReportePlus[]): Promise<void> {
    if (lineas.length === 0) return;
    await this.reportePlusModel.insertMany(
      lineas.map((l) => ({
        fecha: l.fecha ?? new Date(),
        productoId: new Types.ObjectId(l.productoId),
        producto: { codigo: l.codigo, nombre: l.nombre },
        cantidadVendida: l.cantidadVendida,
        stockFinal: l.stockFinal,
        metodoPago: l.metodoPago,
        total: l.total,
        descuento: l.descuento,
        impuesto: l.impuesto,
        origen: l.origen,
        referencia: l.referencia,
        enKardex: l.enKardex,
      })),
    );
  }

  /** Quita las filas abiertas de un documento (p. ej. factura cancelada). */
  async eliminarPorReferencia(referencia: string): Promise<number> {
    const r = await this.reportePlusModel.deleteMany({
      ...this.abiertas,
      referencia,
    });
    return r.deletedCount ?? 0;
  }

  findAll(): Promise<ReportePlus[]> {
    return this.reportePlusModel
      .find(this.abiertas)
      .sort({ fecha: -1, _id: -1 })
      .lean()
      .exec();
  }

  async resumen(): Promise<ResumenReportePlus> {
    const filas = (await this.reportePlusModel
      .find(this.abiertas)
      .lean()
      .exec()) as unknown as FilaReporte[];
    return this.calcularResumen(
      filas,
      await this.inicioDelTurno(filas),
      new Date(),
    );
  }

  async cerrarTurno(): Promise<CierreTurnoResultado> {
    await this.limpiarRestosDeTurnosCerrados();

    const turnoId = new Types.ObjectId();
    const reclamadas = await this.reportePlusModel.updateMany(this.abiertas, {
      $set: { turnoCierre: turnoId },
    });
    if (reclamadas.modifiedCount === 0) {
      throw new BadRequestException(
        'No hay ventas registradas para cerrar el turno',
      );
    }

    const referencia = `RP-${turnoId.toHexString()}`;
    let movimientosKardex = 0;
    let resumen: ResumenReportePlus;
    try {
      const filas = (await this.reportePlusModel
        .find({ turnoCierre: turnoId })
        .sort({ fecha: 1, _id: 1 })
        .lean()
        .exec()) as unknown as FilaReporte[];
      const cierre = new Date();
      resumen = await this.calcularResumen(
        filas,
        await this.inicioDelTurno(filas),
        cierre,
      );

      // 1) Kardex primero (las facturas ya lo escribieron al confirmarse).
      const pendientes = filas.filter((f) => !f.enKardex);
      if (pendientes.length > 0) {
        await this.kardexModel.insertMany(
          pendientes.map((f) => ({
            fecha: f.fecha,
            productoId: f.productoId,
            tipo: KardexTipo.VENTA,
            cantidad: f.cantidadVendida,
            stock: f.stockFinal,
            motivo: `Venta (${f.metodoPago}) - cierre de turno`,
            referencia,
          })),
          { ordered: true, throwOnValidationError: true },
        );
        movimientosKardex = pendientes.length;
      }

      // 2) Historial del turno, antes de vaciar.
      await this.turnoModel.create({
        _id: turnoId,
        desde: resumen.desde,
        cierre,
        totalVentas: resumen.totalVentas,
        totalExtracciones: resumen.totalExtracciones,
        saldoNeto: resumen.saldoNeto,
        cantidadTransferencias: resumen.cantidadTransferencias,
        movimientos: resumen.movimientos,
        porMetodo: resumen.porMetodo,
      });
    } catch (error) {
      await this.compensarCierre(turnoId, referencia);
      this.logger.error(
        `Cierre de turno fallido, no se borró nada: ${String(error)}`,
      );
      throw new InternalServerErrorException(
        'No se pudo cerrar el turno: no se registró en el Kardex y las ventas siguen en el reporte. Intente de nuevo.',
      );
    }

    // 3) Limpiar el reporte. El Kardex y el historial ya están guardados.
    let filasEliminadas = 0;
    try {
      const borradas = await this.reportePlusModel.deleteMany({
        turnoCierre: turnoId,
      });
      filasEliminadas = borradas.deletedCount ?? 0;
    } catch (error) {
      this.logger.error(
        `Turno ${turnoId.toHexString()} guardado pero no se limpió el reporte (se limpiará en el próximo cierre): ${String(error)}`,
      );
    }

    return {
      mensaje: `Turno cerrado: ${movimientosKardex} movimientos registrados en el Kardex`,
      movimientosKardex,
      filasEliminadas,
      resumen,
    };
  }

  /** Cierre del último turno o inicio del día de la primera venta. */
  private async inicioDelTurno(filas: FilaReporte[]): Promise<Date> {
    const ultimo = (await this.turnoModel
      .findOne()
      .sort({ cierre: -1 })
      .select('cierre')
      .lean()
      .exec()) as { cierre: Date } | null;
    if (ultimo) return ultimo.cierre;
    const primera =
      filas.length > 0
        ? new Date(Math.min(...filas.map((f) => new Date(f.fecha).getTime())))
        : new Date();
    primera.setHours(0, 0, 0, 0);
    return primera;
  }

  private async calcularResumen(
    filas: FilaReporte[],
    desde: Date,
    hasta: Date,
  ): Promise<ResumenReportePlus> {
    const porMetodo: TotalesMetodo = {
      efectivo: 0,
      credito: 0,
      transferencia: 0,
      factura: 0,
    };
    const transferencias = new Set<string>();
    for (const f of filas) {
      porMetodo[f.metodoPago] += f.total;
      if (f.metodoPago === MetodoPagoReporte.TRANSFERENCIA)
        transferencias.add(f.referencia);
    }
    for (const k of Object.keys(porMetodo) as (keyof TotalesMetodo)[])
      porMetodo[k] = redondear(porMetodo[k]);

    const totalVentas = redondear(
      porMetodo.efectivo +
        porMetodo.credito +
        porMetodo.transferencia +
        porMetodo.factura,
    );

    const extracciones = (await this.extraccionModel
      .find({ fecha: { $gte: desde, $lte: hasta } })
      .select('monto')
      .lean()
      .exec()) as unknown as { monto: number }[];
    const totalExtracciones = redondear(
      extracciones.reduce((s, e) => s + e.monto, 0),
    );

    return {
      desde,
      totalVentas,
      totalExtracciones,
      saldoNeto: redondear(totalVentas - totalExtracciones),
      cantidadTransferencias: transferencias.size,
      porMetodo,
      movimientos: filas.length,
    };
  }

  /** Deshace un cierre que falló antes de borrar: Kardex fuera, filas liberadas. */
  private async compensarCierre(
    turnoId: Types.ObjectId,
    referencia: string,
  ): Promise<void> {
    try {
      await this.kardexModel.deleteMany({ referencia });
      await this.turnoModel.deleteOne({ _id: turnoId });
      await this.reportePlusModel.updateMany(
        { turnoCierre: turnoId },
        { $unset: { turnoCierre: 1 } },
      );
    } catch (error) {
      this.logger.error(
        `No se pudo compensar el cierre ${turnoId.toHexString()}, revisar a mano (Kardex con referencia ${referencia} y filas con turnoCierre): ${String(error)}`,
      );
    }
  }

  /** Borra filas de turnos que ya se guardaron pero cuyo borrado falló. */
  private async limpiarRestosDeTurnosCerrados(): Promise<void> {
    const marcados = await this.reportePlusModel.distinct('turnoCierre');
    if (marcados.length === 0) return;
    const cerrados = (await this.turnoModel
      .find({ _id: { $in: marcados } })
      .select('_id')
      .lean()
      .exec()) as unknown as { _id: Types.ObjectId }[];
    if (cerrados.length === 0) return;
    await this.reportePlusModel.deleteMany({
      turnoCierre: { $in: cerrados.map((t) => t._id) },
    });
  }
}
