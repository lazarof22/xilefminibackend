import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { valuarMovimiento } from '../kardex/costo-promedio.util';
import { costoDeSalida } from '../kardex/valuacion-salida';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import {
  MetodoPagoReporte,
  ProductoReporte,
  ReportePlus,
} from './schema/reporte_plus.schema';
import { TurnoReportePlus } from './schema/turno_reporte_plus.schema';
import { LineaTurnoArchivada } from './schema/linea-turno-archivada.schema';
import {
  MONEDA_POR_DEFECTO,
  MovimientoMoneda,
  redondear,
  resumirPorMoneda,
  soloDeTurnosAbiertos,
} from './efectivo-turno.util';
import { Devolucion } from '../devolucion/schema/devolucion.schema';
import { devolucionesEfectivoEnVentana } from '../devolucion/devolucion-efectivo.util';
import { LineaReportePlus } from './dto/registrar-venta-reporte.dto';
import { insertarIgnorandoDuplicados } from '../../../common/utils/insertar-idempotente';
import {
  CierreTurnoResultado,
  ResumenReportePlus,
  TotalesMetodo,
} from './dto/resumen-reporte-plus.dto';

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
> &
  Partial<
    Pick<ReportePlus, 'moneda' | 'descuento' | 'impuesto' | 'origen'> & {
      producto: ProductoReporte;
    }
  >;

/**
 * Reporte Plus: ventas del turno actual.
 *
 * Cerrar turno (MongoDB local sin réplica => sin transacciones):
 *  1. Se "reclaman" las filas abiertas con un id de turno (un solo updateMany
 *     atómico). Las ventas que lleguen durante el cierre quedan sin marca y
 *     pertenecen al turno siguiente: nunca se borra una venta sin pasar al Kardex.
 *  2. Se escribe el Kardex, se guarda el resumen del turno y se ARCHIVAN las
 *     líneas (`LineaTurnoArchivada`): el detalle por producto no se pierde.
 *  3. Si algo falla antes de borrar, se compensa (borra lo escrito en Kardex,
 *     el resumen y el archivo parcial, y libera las filas) y no se pierde nada.
 *  4. Solo entonces se eliminan las filas reclamadas.
 *
 * El resumen NO mezcla dinero en caja con cuentas por cobrar: informa por
 * separado, por moneda, el efectivo esperado, las cuentas por cobrar y los
 * cobros electrónicos (doc §6.6).
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
    @InjectModel(TurnoCaja.name) private turnoCajaModel: Model<TurnoCaja>,
    @InjectModel(DepositoBancario.name)
    private depositoModel: Model<DepositoBancario>,
    @InjectModel(LineaTurnoArchivada.name)
    private archivadaModel: Model<LineaTurnoArchivada>,
    @InjectModel(Devolucion.name)
    private devolucionModel: Model<Devolucion>,
    /**
     * Only the `precio_compra` fallback of the valuation (SC-2-13) needs it;
     * without it the legacy rows are still valued at the Kardex average.
     */
    @Optional()
    @InjectModel(Producto.name)
    private productoModel?: Model<Producto>,
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
        moneda: l.moneda || MONEDA_POR_DEFECTO,
      })),
    );
  }

  /**
   * Como `registrarLineas`, pero cada línea trae su `id` (el `_id` de la fila)
   * y el paso es repetible: las filas que ya existen se ignoran. Lo usa el
   * checkout, que repite este paso al recuperar una operación caída.
   */
  async registrarLineasRepetible(lineas: LineaReportePlus[]): Promise<void> {
    await insertarIgnorandoDuplicados(
      this.reportePlusModel,
      lineas.map((l) => {
        if (!l.id) {
          throw new BadRequestException(
            'Cada línea del reporte necesita su id para poder repetirse sin duplicar',
          );
        }
        return {
          _id: new Types.ObjectId(l.id),
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
        };
      }),
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
        // SC-2-13: valued at the product's current average cost, read once
        // per product. A failed read never blocks the close: row unvalued.
        const costos = new Map<string, number | undefined>();
        for (const f of pendientes) {
          const clave = String(f.productoId);
          if (!costos.has(clave)) {
            costos.set(
              clave,
              await costoDeSalida(
                this.kardexModel,
                this.productoModel,
                clave,
                this.logger,
              ),
            );
          }
        }
        await this.kardexModel.insertMany(
          pendientes.map((f) => ({
            fecha: f.fecha,
            productoId: f.productoId,
            tipo: KardexTipo.VENTA,
            cantidad: f.cantidadVendida,
            stock: f.stockFinal,
            motivo: `Venta (${f.metodoPago}) - cierre de turno`,
            referencia,
            ...valuarMovimiento(
              f.cantidadVendida,
              costos.get(String(f.productoId)),
            ),
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
        efectivoEsperado: resumen.efectivoEsperado,
        cuentasPorCobrar: resumen.cuentasPorCobrar,
        cobrosElectronicos: resumen.cobrosElectronicos,
        facturado: resumen.facturado,
        detalleEfectivo: resumen.detalleEfectivo,
      });

      // 3) Archivo del detalle del turno, también antes de vaciar.
      await this.archivadaModel.insertMany(
        filas.map((f) => ({
          turnoReportePlusId: turnoId,
          fecha: f.fecha,
          productoId: f.productoId,
          producto: f.producto,
          cantidadVendida: f.cantidadVendida,
          stockFinal: f.stockFinal,
          metodoPago: f.metodoPago,
          moneda: f.moneda || MONEDA_POR_DEFECTO,
          total: f.total,
          descuento: f.descuento ?? 0,
          impuesto: f.impuesto ?? 0,
          origen: f.origen,
          referencia: f.referencia,
          enKardex: f.enKardex,
        })),
        { ordered: true },
      );
    } catch (error) {
      await this.compensarCierre(turnoId, referencia);
      this.logger.error(
        `Cierre de turno fallido, no se borró nada: ${String(error)}`,
      );
      throw new InternalServerErrorException(
        'No se pudo cerrar el turno: no se registró en el Kardex ni en el archivo y las ventas siguen en el reporte. Intente de nuevo.',
      );
    }

    // 4) Limpiar el reporte. El Kardex y el historial ya están guardados.
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

    const ventana = { fecha: { $gte: desde, $lte: hasta } };
    const extracciones = (await this.extraccionModel
      .find(ventana)
      .select('monto moneda turnoCaja')
      .lean()
      .exec()) as unknown as (MovimientoMoneda & { turnoCaja?: unknown })[];
    const totalExtracciones = redondear(
      extracciones.reduce((s, e) => s + e.monto, 0),
    );
    const depositos = (await this.depositoModel
      .find(ventana)
      .select('monto moneda turnoCajaId')
      .lean()
      .exec()) as unknown as (MovimientoMoneda & { turnoCajaId?: unknown })[];
    const turnosAbiertos = (await this.turnoCajaModel
      .find({ estado: EstadoTurnoCaja.ABIERTO })
      .select('fondoInicial')
      .lean()
      .exec()) as unknown as {
      _id?: unknown;
      fondoInicial?: Record<string, number>;
    }[];
    const idsAbiertos = new Set(turnosAbiertos.map((t) => String(t._id)));

    // Fondo inicial = suma por moneda de los turnos de caja abiertos (el
    // Reporte Plus es la caja registradora compartida del punto de venta).
    const fondoInicial: Record<string, number> = {};
    for (const t of turnosAbiertos)
      for (const [moneda, monto] of Object.entries(t.fondoInicial ?? {}))
        fondoInicial[moneda] = (fondoInicial[moneda] ?? 0) + monto;

    // Las líneas ya vienen netas del cambio: el efectivo recibido es el cobro
    // neto en efectivo. Los cobros aplicados a crédito se enchufan aquí cuando
    // exista su módulo (hoy 0); las devoluciones en efectivo ya se descuentan.
    const devolucionesEfectivo = await devolucionesEfectivoEnVentana(
      this.devolucionModel,
      desde,
      hasta,
    );
    const monedas = resumirPorMoneda({
      fondoInicial,
      filas,
      // Efectivo esperado por turno ABIERTO: lo de un turno cerrado no cuenta.
      extracciones: soloDeTurnosAbiertos(
        extracciones,
        (e) => e.turnoCaja,
        idsAbiertos,
      ),
      depositos: soloDeTurnosAbiertos(
        depositos,
        (d) => d.turnoCajaId,
        idsAbiertos,
      ),
      devolucionesEfectivo,
    });

    return {
      desde,
      totalVentas,
      totalExtracciones,
      saldoNeto: redondear(totalVentas - totalExtracciones),
      ...monedas,
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
      await this.archivadaModel.deleteMany({ turnoReportePlusId: turnoId });
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
