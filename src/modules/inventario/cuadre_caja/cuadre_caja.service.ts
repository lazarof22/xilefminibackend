import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { CreateCuadreCajaDto } from './dto/create-cuadre_caja.dto';
import { UpdateCuadreCajaDto } from './dto/update-cuadre_caja.dto';
import { InjectModel } from '@nestjs/mongoose';
import { CuadreCaja, DesgloseBilletes } from './schema/cuadre_caja.schema';
import { Usuarios } from '../../auth/schemas/usuarios.schema';
import { Venta } from '../venta/schema/venta.schema';
import { Pago } from '../pago/schema/pago.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { normalizarFecha, rangoDelDia } from '../../../common/utils/fecha.util';
import { Model, Types, UpdateQuery, isValidObjectId } from 'mongoose';
import { MONEDA_BASE } from '../pago/divisas';
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import { Devolucion } from '../devolucion/schema/devolucion.schema';
import { devolucionesEfectivoEnVentana } from '../devolucion/devolucion-efectivo.util';
import { calcularEfectivoEsperado } from '../reporte_plus/efectivo-turno.util';
import {
  ajusteDivisasCUP,
  flujoDeEfectivo,
  PagoEfectivoLeido,
} from './cuadre-divisas';

@Injectable()
export class CuadreCajaService {
  constructor(
    @InjectModel(CuadreCaja.name) private cuadreCajaModel: Model<CuadreCaja>,
    @InjectModel(Usuarios.name) private usuarioModel: Model<Usuarios>,
    @InjectModel(Venta.name) private ventaModel: Model<Venta>,
    @InjectModel(Pago.name) private pagoModel: Model<Pago>,
    @InjectModel(Extraccion.name)
    private extraccionModel: Model<Extraccion>,
    // Datos del turno de caja: sin ellos el cuadre es el de siempre (sin fondo,
    // depósitos ni devoluciones en efectivo).
    @Optional()
    @InjectModel(TurnoCaja.name)
    private turnoModel?: Model<TurnoCaja>,
    @Optional()
    @InjectModel(DepositoBancario.name)
    private depositoModel?: Model<DepositoBancario>,
    @Optional()
    @InjectModel(Devolucion.name)
    private devolucionModel?: Model<Devolucion>,
  ) {}

  async create(createCuadreCajaDto: CreateCuadreCajaDto): Promise<CuadreCaja> {
    const { empleado } = createCuadreCajaDto;

    if (!Types.ObjectId.isValid(empleado)) {
      throw new BadRequestException('El ID del empleado no es válido');
    }

    const empleadoExist = await this.usuarioModel.findById(empleado);
    if (!empleadoExist) {
      throw new NotFoundException('El empleado no existe');
    }

    const otros = createCuadreCajaDto.otros_motivos ?? [];
    const moneda = createCuadreCajaDto.moneda?.trim() || MONEDA_BASE;
    const turno = await this.turnoAbierto(empleado);
    const turnoMoneda = turno
      ? await this.movimientosDelTurno(turno, moneda)
      : SIN_TURNO;
    const fisico = {
      moneda,
      fondo_inicial: turnoMoneda.fondoInicial,
      depositos_bancarios:
        createCuadreCajaDto.depositos_bancarios ?? turnoMoneda.depositos,
      devoluciones_efectivo:
        createCuadreCajaDto.devoluciones_efectivo ?? turnoMoneda.devoluciones,
    };

    const nuevoCuadre = new this.cuadreCajaModel({
      ...createCuadreCajaDto,
      creditos: createCuadreCajaDto.creditos ?? 0,
      otros_motivos: otros,
      ...fisico,
      turnoCaja: turno?._id,
      ...this.calcular({
        ...createCuadreCajaDto,
        ...fisico,
        otros_motivos: otros,
      }),
    });
    const guardado = await nuevoCuadre.save();
    await this.vincularConTurno(turno?._id, guardado);
    return guardado;
  }

  /** Turno abierto del cajero (el empleado del cuadre), si lo tiene. */
  private async turnoAbierto(cajeroId: string): Promise<TurnoLeido | null> {
    if (!this.turnoModel || !isValidObjectId(cajeroId)) return null;
    return (await this.turnoModel
      .findOne({
        cajeroId: new Types.ObjectId(cajeroId),
        estado: EstadoTurnoCaja.ABIERTO,
      })
      .lean()
      .exec()) as TurnoLeido | null;
  }

  /** Deja anotado en el turno el cuadre con el que se cerró la caja. */
  private async vincularConTurno(
    turnoId: Types.ObjectId | undefined,
    cuadre: unknown,
  ): Promise<void> {
    const cuadreId = (cuadre as { _id?: unknown })._id;
    if (!turnoId || !cuadreId || !this.turnoModel) return;
    await this.turnoModel.updateOne(
      { _id: turnoId },
      { $set: { cuadre: cuadreId } },
    );
  }

  /** Lo que el turno aporta al cuadre de UNA moneda: su fondo, depósitos y devoluciones. */
  private async movimientosDelTurno(
    turno: TurnoLeido,
    moneda: string,
  ): Promise<MovimientosDelTurno> {
    return {
      fondoInicial: turno.fondoInicial?.[moneda] ?? 0,
      depositos: await this.depositosDelTurno(turno._id, moneda),
      devoluciones: await this.devolucionesEfectivo(
        turno.fechaApertura,
        new Date(),
        moneda,
        turno._id,
      ),
    };
  }

  /**
   * Devoluciones pagadas en efectivo en una moneda y ventana de tiempo: salida
   * física de caja (un vale con turno cuenta solo en él; el resto se cruza por fecha).
   */
  private async devolucionesEfectivo(
    desde: Date,
    hasta: Date,
    moneda: string,
    turnoId?: Types.ObjectId,
  ): Promise<number> {
    if (!this.devolucionModel) return 0;
    const movimientos = await devolucionesEfectivoEnVentana(
      this.devolucionModel,
      desde,
      hasta,
      turnoId,
    );
    return this.sumarDeLaMoneda(movimientos, moneda);
  }

  /** Depósitos bancarios del turno en una moneda (salida física del cuadre). */
  private async depositosDelTurno(
    turnoId: Types.ObjectId,
    moneda: string,
  ): Promise<number> {
    if (!this.depositoModel) return 0;
    const depositos = (await this.depositoModel
      .find({ turnoCajaId: turnoId })
      .lean()
      .exec()) as unknown as MovimientoDeMoneda[];
    return this.sumarDeLaMoneda(depositos, moneda);
  }

  /** Suma los montos de una moneda; un movimiento sin moneda es en CUP. */
  private sumarDeLaMoneda(
    movimientos: MovimientoDeMoneda[],
    moneda: string,
  ): number {
    return this.redondear(
      movimientos
        .filter((m) => (m.moneda || MONEDA_BASE) === moneda)
        .reduce((sum, m) => sum + (m.monto || 0), 0),
    );
  }

  /**
   * Efectivo esperado de UNA moneda (doc §6.6): fondo inicial del turno
   * + efectivo recibido - cambio entregado - devoluciones en efectivo
   * - extracciones - depósitos bancarios ± otros motivos.
   *
   * En CUP, si no se informa `efectivo_recibido` se deriva de las ventas del
   * día: ventas netas (ya incluyen descuentos e impuestos) + recargos
   * - transferencias - créditos + ajuste por divisas (las ventas cobradas o
   * devueltas en otra moneda no movieron CUP por su total: ver
   * `cuadre-divisas.ts`). `descuentos` es informativo porque ya está restado
   * en `total_ventas_dia`. Sin turno, depósitos ni devoluciones, es el cálculo
   * de siempre.
   *
   * En otra moneda los totales de venta (en CUP) no se le atribuyen: lo
   * recibido y el cambio de esa caja los informa el cajero (ver
   * `efectivo_por_moneda` del resumen).
   */
  private calcular(datos: CalculoCuadre): {
    total_efectivo: number;
    efectivo_esperado: number;
    diferencia: number;
    estado: 'cuadrado' | 'diferencia';
  } {
    const totalEfectivo = this.redondear(
      datos.total_efectivo ??
        this.calcularTotalDesglose(datos.desglose_billetes),
    );
    const otros = (datos.otros_motivos ?? []).reduce(
      (sum, m) => sum + (m.tipo === 'ingreso' ? m.monto : -m.monto),
      0,
    );
    const efectivoEsperado = this.redondear(
      calcularEfectivoEsperado({
        fondoInicial: datos.fondo_inicial ?? 0,
        efectivoRecibido: this.efectivoRecibido(datos),
        cambioEntregado: datos.cambio_entregado,
        devolucionesEfectivo: datos.devoluciones_efectivo,
        extracciones: datos.total_extracciones_dia || 0,
        depositosBancarios: datos.depositos_bancarios,
      }) + otros,
    );
    const diferencia = this.redondear(totalEfectivo - efectivoEsperado);
    return {
      total_efectivo: totalEfectivo,
      efectivo_esperado: efectivoEsperado,
      diferencia,
      estado: Math.abs(diferencia) < 0.01 ? 'cuadrado' : 'diferencia',
    };
  }

  /** Entradas físicas de la moneda del cuadre: lo informado o, en CUP, lo derivado de las ventas. */
  private efectivoRecibido(datos: CalculoCuadre): number {
    if (
      datos.efectivo_recibido !== undefined &&
      datos.efectivo_recibido !== null
    )
      return datos.efectivo_recibido;
    if ((datos.moneda ?? MONEDA_BASE) !== MONEDA_BASE) return 0;
    return (
      (datos.total_ventas_dia || 0) +
      (datos.recargos || 0) -
      (datos.valor_transferencias || 0) -
      (datos.creditos || 0) +
      (datos.ajuste_divisas || 0)
    );
  }

  private redondear(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  private calcularTotalDesglose(desglose?: Partial<DesgloseBilletes>): number {
    return (
      (desglose?.billete5000 || 0) * 5000 +
      (desglose?.billete2000 || 0) * 2000 +
      (desglose?.billete1000 || 0) * 1000 +
      (desglose?.billete500 || 0) * 500 +
      (desglose?.billete200 || 0) * 200 +
      (desglose?.billete100 || 0) * 100 +
      (desglose?.billete50 || 0) * 50 +
      (desglose?.billete20 || 0) * 20 +
      (desglose?.billete10 || 0) * 10 +
      (desglose?.billete5 || 0) * 5 +
      (desglose?.billete3 || 0) * 3 +
      (desglose?.billete1 || 0) * 1
    );
  }

  async findAll(fecha?: string): Promise<CuadreCaja[]> {
    const filter: Record<string, any> = {};
    if (fecha) {
      const { inicio, fin } = rangoDelDia(fecha);
      filter.fecha = { $gte: inicio, $lte: fin };
    }
    return this.cuadreCajaModel
      .find(filter)
      .populate({ path: 'empleado', select: 'nombre_empleado ci_empleado' })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<CuadreCaja> {
    const cuadre = await this.cuadreCajaModel
      .findById(id)
      .populate({ path: 'empleado', select: 'nombre_empleado ci_empleado' })
      .exec();

    if (!cuadre) {
      throw new NotFoundException('No se encontró el cuadre de caja');
    }
    return cuadre;
  }

  async update(
    id: string,
    updateCuadreCajaDto: UpdateCuadreCajaDto,
  ): Promise<CuadreCaja> {
    if (updateCuadreCajaDto.empleado) {
      const existe = await this.usuarioModel.findById(
        updateCuadreCajaDto.empleado,
      );
      if (!existe) throw new NotFoundException('El empleado no existe');
    }

    const actual = await this.cuadreCajaModel.findById(id).lean().exec();
    if (!actual) {
      throw new NotFoundException('No se encontró el cuadre de caja');
    }

    const desglose = updateCuadreCajaDto.desglose_billetes
      ? {
          ...actual.desglose_billetes,
          ...updateCuadreCajaDto.desglose_billetes,
        }
      : actual.desglose_billetes;
    const totalEfectivo =
      updateCuadreCajaDto.total_efectivo ??
      (updateCuadreCajaDto.desglose_billetes
        ? this.calcularTotalDesglose(desglose)
        : actual.total_efectivo);

    const merged: CalculoCuadre = {
      total_ventas_dia:
        updateCuadreCajaDto.total_ventas_dia ?? actual.total_ventas_dia,
      recargos: updateCuadreCajaDto.recargos ?? actual.recargos,
      total_extracciones_dia:
        updateCuadreCajaDto.total_extracciones_dia ??
        actual.total_extracciones_dia,
      valor_transferencias:
        updateCuadreCajaDto.valor_transferencias ?? actual.valor_transferencias,
      creditos: updateCuadreCajaDto.creditos ?? actual.creditos,
      ajuste_divisas:
        updateCuadreCajaDto.ajuste_divisas ?? actual.ajuste_divisas,
      otros_motivos: updateCuadreCajaDto.otros_motivos ?? actual.otros_motivos,
      desglose_billetes: desglose,
      total_efectivo: totalEfectivo,
      // Moneda, fondo y salidas físicas: lo guardado en el cuadre, salvo lo que se corrija.
      moneda: actual.moneda,
      fondo_inicial: actual.fondo_inicial,
      efectivo_recibido:
        updateCuadreCajaDto.efectivo_recibido ?? actual.efectivo_recibido,
      cambio_entregado:
        updateCuadreCajaDto.cambio_entregado ?? actual.cambio_entregado,
      devoluciones_efectivo:
        updateCuadreCajaDto.devoluciones_efectivo ??
        actual.devoluciones_efectivo,
      depositos_bancarios:
        updateCuadreCajaDto.depositos_bancarios ?? actual.depositos_bancarios,
    };

    const updateData: UpdateQuery<CuadreCaja> = {
      ...updateCuadreCajaDto,
      desglose_billetes: desglose,
      ...this.calcular(merged),
    };

    const updateCuadre = await this.cuadreCajaModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate({ path: 'empleado', select: 'nombre_empleado ci_empleado' })
      .exec();

    if (!updateCuadre) {
      throw new NotFoundException('No se encontró el cuadre de caja');
    }
    return updateCuadre;
  }

  async remove(id: string): Promise<void> {
    const deleteCuadre = await this.cuadreCajaModel
      .findByIdAndDelete(id)
      .exec();
    if (!deleteCuadre) {
      throw new NotFoundException('No se encontró el cuadre de caja');
    }
  }

  async getTotalDia(fecha?: string): Promise<{ total: number }> {
    const { inicio, fin } = rangoDelDia(fecha);
    const ventas = await this.ventaModel
      .find({ createdAt: { $gte: inicio, $lte: fin } })
      .lean()
      .exec();

    const total = ventas.reduce(
      (sum, venta) => sum + this.totalVenta(venta),
      0,
    );
    return { total: this.redondear(total) };
  }

  /**
   * Totales del día para precargar el cuadre. Cada venta se clasifica por el
   * método de su pago y se suma por su total neto; los pagos "cuenta casa" no
   * entran efectivo a caja y se reportan junto a los créditos.
   *
   * Los totales de venta están siempre en CUP: se informan tal cual cuando la
   * moneda es CUP y valen 0 en otra moneda, cuya caja se cuenta con
   * `efectivo_por_moneda`. Con `empleado` o `moneda` se añaden los datos del
   * turno abierto (fondo, depósitos y devoluciones de esa moneda).
   */
  async getResumenDiario(
    fecha?: string,
    empleado?: string,
    monedaPedida?: string,
  ): Promise<ResumenDiario> {
    const moneda = monedaPedida?.trim() || MONEDA_BASE;
    const fechaDia = normalizarFecha(fecha);
    const { inicio, fin } = rangoDelDia(fechaDia);

    const ventas = await this.ventaModel
      .find({ createdAt: { $gte: inicio, $lte: fin } })
      .lean()
      .exec();

    const pagoIds = ventas.map((v) => v.pago).filter(Boolean);
    const pagos = pagoIds.length
      ? await this.pagoModel
          .find({ _id: { $in: pagoIds } })
          .lean<PagoResumen[]>()
          .exec()
      : [];
    const pagosPorId = new Map(pagos.map((p) => [String(p._id), p]));
    const dia = this.resumirVentas(ventas, pagosPorId);
    const enCUP = moneda === MONEDA_BASE;

    const extracciones = (await this.extraccionModel
      .find({ fecha: { $gte: inicio, $lte: fin } })
      .lean()
      .exec()) as unknown as MovimientoDeMoneda[];

    const resumen: ResumenDiario = {
      fecha: fechaDia,
      cantidad_ventas: enCUP
        ? ventas.length
        : (dia.porMoneda.get(moneda)?.ventas ?? 0),
      total_ventas_dia: this.redondear(enCUP ? dia.totalVentas : 0),
      total_efectivo: this.redondear(enCUP ? dia.totalEfectivo : 0),
      valor_transferencias: this.redondear(enCUP ? dia.totalTransferencias : 0),
      total_creditos: this.redondear(enCUP ? dia.totalCreditos : 0),
      descuentos: this.redondear(enCUP ? dia.totalDescuentos : 0),
      total_extracciones_dia: this.sumarDeLaMoneda(extracciones, moneda),
      ajuste_divisas: this.redondear(enCUP ? dia.ajusteDivisas : 0),
      efectivo_por_moneda: this.efectivoPorMoneda(dia.porMoneda),
    };

    if (empleado === undefined && !monedaPedida?.trim()) return resumen;
    return {
      ...resumen,
      ...(await this.datosDelTurno(empleado, moneda, inicio, fin)),
    };
  }

  /** Clasifica las ventas del día por método de pago y mide lo que cada una movió en cada caja física. */
  private resumirVentas(
    ventas: Partial<Venta>[],
    pagosPorId: Map<string, PagoResumen>,
  ): VentasDelDia {
    const dia: VentasDelDia = {
      totalVentas: 0,
      totalEfectivo: 0,
      totalTransferencias: 0,
      totalCreditos: 0,
      totalDescuentos: 0,
      ajusteDivisas: 0,
      porMoneda: new Map(),
    };
    const caja = (moneda: string) => {
      const entrada = dia.porMoneda.get(moneda) ?? {
        recibido: 0,
        cambio: 0,
        ventas: 0,
      };
      dia.porMoneda.set(moneda, entrada);
      return entrada;
    };

    for (const venta of ventas) {
      const total = this.totalVenta(venta);
      dia.totalVentas += total;
      dia.totalDescuentos += venta.descuento_total || 0;

      const pago = pagosPorId.get(String(venta.pago));
      if (pago?.metodoPago === 'transferencia') {
        dia.totalTransferencias += total;
      } else if (pago?.metodoPago === 'credito' || pago?.esCuentaCasa) {
        dia.totalCreditos += total;
      } else {
        dia.totalEfectivo += total;

        // Qué entró y salió de cada caja física (CUP, USD...) por esta venta.
        const flujo = flujoDeEfectivo(pago, total);
        dia.ajusteDivisas += ajusteDivisasCUP(flujo, total);

        const entrada = caja(flujo.moneda);
        entrada.recibido += flujo.recibido;
        entrada.ventas += 1;
        const salida = caja(flujo.monedaCambio);
        salida.cambio += flujo.cambio;
        if (flujo.monedaCambio !== flujo.moneda) salida.ventas += 1;
      }
    }
    return dia;
  }

  private efectivoPorMoneda(
    porMoneda: VentasDelDia['porMoneda'],
  ): EfectivoPorMoneda[] {
    return [...porMoneda.entries()]
      .sort(([a], [b]) =>
        a === MONEDA_BASE ? -1 : b === MONEDA_BASE ? 1 : a.localeCompare(b),
      )
      .map(([moneda, { recibido, cambio }]) => ({
        moneda,
        recibido: this.redondear(recibido),
        cambio_entregado: this.redondear(cambio),
        neto: this.redondear(recibido - cambio),
      }));
  }

  /** Campos del resumen que salen del turno abierto del cajero, en la moneda pedida. */
  private async datosDelTurno(
    empleado: string | undefined,
    moneda: string,
    inicio: Date,
    fin: Date,
  ): Promise<DatosDelTurno> {
    const turno = empleado ? await this.turnoAbierto(empleado) : null;
    return {
      moneda,
      turnoCajaId: turno ? turno._id.toHexString() : null,
      fondo_inicial: turno?.fondoInicial?.[moneda] ?? 0,
      depositos_bancarios: turno
        ? await this.depositosDelTurno(turno._id, moneda)
        : 0,
      devoluciones_efectivo: await this.devolucionesEfectivo(
        inicio,
        fin,
        moneda,
        turno?._id,
      ),
    };
  }

  private totalVenta(venta: Partial<Venta>): number {
    return (
      (venta.subtotal_venta || 0) -
      (venta.descuento_total || 0) +
      (venta.impuesto || 0)
    );
  }
}

type CalculoCuadre = Pick<
  CreateCuadreCajaDto,
  | 'total_ventas_dia'
  | 'recargos'
  | 'ajuste_divisas'
  | 'total_extracciones_dia'
  | 'valor_transferencias'
  | 'creditos'
  | 'total_efectivo'
  | 'efectivo_recibido'
  | 'cambio_entregado'
  | 'devoluciones_efectivo'
  | 'depositos_bancarios'
> & {
  moneda?: string;
  fondo_inicial?: number;
  desglose_billetes?: Partial<DesgloseBilletes>;
  otros_motivos?: { monto: number; tipo: string }[];
};

interface TurnoLeido {
  _id: Types.ObjectId;
  fechaApertura: Date;
  fondoInicial?: Record<string, number>;
}

interface MovimientoDeMoneda {
  monto: number;
  moneda?: string;
}

interface VentasDelDia {
  totalVentas: number;
  totalEfectivo: number;
  totalTransferencias: number;
  totalCreditos: number;
  totalDescuentos: number;
  ajusteDivisas: number;
  /** Por caja física: lo recibido, el cambio entregado y las ventas en efectivo que la movieron. */
  porMoneda: Map<string, { recibido: number; cambio: number; ventas: number }>;
}

interface MovimientosDelTurno {
  fondoInicial: number;
  depositos: number;
  devoluciones: number;
}

const SIN_TURNO: MovimientosDelTurno = {
  fondoInicial: 0,
  depositos: 0,
  devoluciones: 0,
};

interface PagoResumen extends PagoEfectivoLeido {
  _id: Types.ObjectId;
  metodoPago?: string;
  esCuentaCasa?: boolean;
}

/** Lo que entró y salió de una caja física (una moneda) con las ventas en efectivo del día. */
export interface EfectivoPorMoneda {
  moneda: string;
  /** Lo que entregaron los clientes en esa moneda. */
  recibido: number;
  /** El cambio que salió de la caja en esa moneda. */
  cambio_entregado: number;
  /** Lo que queda en esa caja por las ventas del día (recibido − cambio). */
  neto: number;
}

/** Datos del turno abierto del cajero para la moneda del resumen. */
export interface DatosDelTurno {
  /** Moneda de las cifras del turno y de las de caja física. */
  moneda: string;
  /** Turno abierto del empleado, si lo tiene. */
  turnoCajaId: string | null;
  fondo_inicial: number;
  depositos_bancarios: number;
  devoluciones_efectivo: number;
}

export interface ResumenDiario extends Partial<DatosDelTurno> {
  fecha: string;
  cantidad_ventas: number;
  total_ventas_dia: number;
  total_efectivo: number;
  valor_transferencias: number;
  total_creditos: number;
  descuentos: number;
  total_extracciones_dia: number;
  /** Corrección en CUP por las ventas en efectivo cobradas o devueltas en otra moneda (suele ser negativa). */
  ajuste_divisas: number;
  /** Efectivo por moneda física, para contar cada caja por separado. */
  efectivo_por_moneda: EfectivoPorMoneda[];
}
