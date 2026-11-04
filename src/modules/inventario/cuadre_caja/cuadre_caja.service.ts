import {
  Injectable,
  NotFoundException,
  BadRequestException,
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
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import {
  calcularEfectivoEsperado,
  MONEDA_POR_DEFECTO,
  monedaDelPago,
  redondear,
} from '../reporte_plus/efectivo-turno.util';

@Injectable()
export class CuadreCajaService {
  constructor(
    @InjectModel(CuadreCaja.name) private cuadreCajaModel: Model<CuadreCaja>,
    @InjectModel(Usuarios.name) private usuarioModel: Model<Usuarios>,
    @InjectModel(Venta.name) private ventaModel: Model<Venta>,
    @InjectModel(Pago.name) private pagoModel: Model<Pago>,
    @InjectModel(Extraccion.name)
    private extraccionModel: Model<Extraccion>,
    @InjectModel(TurnoCaja.name) private turnoModel: Model<TurnoCaja>,
    @InjectModel(DepositoBancario.name)
    private depositoModel: Model<DepositoBancario>,
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
    const moneda = createCuadreCajaDto.moneda?.trim() || MONEDA_POR_DEFECTO;
    const turno = await this.turnoAbierto(empleado);
    const fondoInicial = turno?.fondoInicial?.[moneda] ?? 0;
    const depositosTurno = turno
      ? await this.depositosDelTurno(turno._id, moneda)
      : 0;

    const nuevoCuadre = new this.cuadreCajaModel({
      ...createCuadreCajaDto,
      creditos: createCuadreCajaDto.creditos ?? 0,
      otros_motivos: otros,
      moneda,
      turnoCaja: turno?._id,
      fondo_inicial: fondoInicial,
      depositos_bancarios:
        createCuadreCajaDto.depositos_bancarios ?? depositosTurno,
      ...this.calcular({
        ...createCuadreCajaDto,
        otros_motivos: otros,
        fondo_inicial: fondoInicial,
        depositos_bancarios:
          createCuadreCajaDto.depositos_bancarios ?? depositosTurno,
      }),
    });
    const guardado = await nuevoCuadre.save();
    if (turno && (guardado as { _id?: unknown })._id)
      await this.turnoModel.updateOne(
        { _id: turno._id },
        { $set: { cuadre: (guardado as { _id: Types.ObjectId })._id } },
      );
    return guardado;
  }

  /** Turno abierto del cajero (el empleado del cuadre), si lo tiene. */
  private async turnoAbierto(cajeroId: string): Promise<{
    _id: Types.ObjectId;
    fondoInicial?: Record<string, number>;
  } | null> {
    return (await this.turnoModel
      .findOne({
        cajeroId: new Types.ObjectId(cajeroId),
        estado: EstadoTurnoCaja.ABIERTO,
      })
      .lean()
      .exec()) as {
      _id: Types.ObjectId;
      fondoInicial?: Record<string, number>;
    } | null;
  }

  /** Depósitos bancarios del turno en una moneda (salida física del cuadre). */
  private async depositosDelTurno(
    turnoId: Types.ObjectId,
    moneda: string,
  ): Promise<number> {
    const depositos = (await this.depositoModel
      .find({ turnoCajaId: turnoId })
      .lean()
      .exec()) as unknown as { monto: number; moneda?: string }[];
    return this.redondear(
      depositos
        .filter((d) => (d.moneda || MONEDA_POR_DEFECTO) === moneda)
        .reduce((sum, d) => sum + d.monto, 0),
    );
  }

  /**
   * Efectivo esperado de UNA moneda (doc §6.6):
   * fondo inicial + entradas físicas - salidas físicas, donde las entradas
   * son el efectivo recibido y las salidas el cambio entregado, las
   * devoluciones en efectivo, las extracciones y los depósitos bancarios.
   *
   * Si el cliente no informa `efectivo_recibido`, se deriva de los campos de
   * siempre: ventas netas (ya incluyen descuentos e impuestos) + recargos -
   * transferencias - créditos. Con fondo 0 y sin depósitos el resultado es el
   * de antes. `descuentos` es informativo porque ya está restado en
   * `total_ventas_dia`. "Otros motivos" ajusta ± al final.
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
    const efectivoRecibido =
      datos.efectivo_recibido ??
      (datos.total_ventas_dia || 0) +
        (datos.recargos || 0) -
        (datos.valor_transferencias || 0) -
        (datos.creditos || 0);
    const efectivoEsperado = this.redondear(
      calcularEfectivoEsperado({
        fondoInicial: datos.fondo_inicial ?? 0,
        efectivoRecibido,
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

  private redondear(n: number): number {
    return redondear(n);
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
      otros_motivos: updateCuadreCajaDto.otros_motivos ?? actual.otros_motivos,
      desglose_billetes: desglose,
      total_efectivo: totalEfectivo,
      // Fondo y salidas físicas: lo guardado en el cuadre, salvo lo que se corrija.
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
   */
  async getResumenDiario(
    fecha?: string,
    empleado?: string,
    monedaPedida?: string,
  ): Promise<ResumenDiario> {
    const moneda = monedaPedida?.trim() || MONEDA_POR_DEFECTO;
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

    let totalVentas = 0;
    let totalEfectivo = 0;
    let totalTransferencias = 0;
    let totalCreditos = 0;
    let totalDescuentos = 0;

    let cantidadVentas = 0;
    for (const venta of ventas) {
      const pago = pagosPorId.get(String(venta.pago));
      // Solo la moneda pedida: las monedas no se suman entre sí.
      if (monedaDelPago(pago) !== moneda) continue;
      cantidadVentas += 1;
      const total = this.totalVenta(venta);
      totalVentas += total;
      totalDescuentos += venta.descuento_total || 0;

      if (pago?.metodoPago === 'transferencia') {
        totalTransferencias += total;
      } else if (pago?.metodoPago === 'credito' || pago?.esCuentaCasa) {
        totalCreditos += total;
      } else {
        totalEfectivo += total;
      }
    }

    const extracciones = await this.extraccionModel
      .find({ fecha: { $gte: inicio, $lte: fin } })
      .lean()
      .exec();
    const totalExtracciones = extracciones
      .filter((e) => (e.moneda || MONEDA_POR_DEFECTO) === moneda)
      .reduce((sum, e) => sum + (e.monto || 0), 0);

    const turno =
      empleado && isValidObjectId(empleado)
        ? await this.turnoAbierto(empleado)
        : null;
    const depositos = turno
      ? await this.depositosDelTurno(turno._id, moneda)
      : 0;

    return {
      fecha: fechaDia,
      cantidad_ventas: cantidadVentas,
      total_ventas_dia: this.redondear(totalVentas),
      total_efectivo: this.redondear(totalEfectivo),
      valor_transferencias: this.redondear(totalTransferencias),
      total_creditos: this.redondear(totalCreditos),
      descuentos: this.redondear(totalDescuentos),
      total_extracciones_dia: this.redondear(totalExtracciones),
      moneda,
      turnoCajaId: turno ? turno._id.toHexString() : null,
      fondo_inicial: turno?.fondoInicial?.[moneda] ?? 0,
      depositos_bancarios: depositos,
      // Sin módulo de devoluciones en efectivo todavía: se informa 0.
      devoluciones_efectivo: 0,
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
  | 'total_extracciones_dia'
  | 'valor_transferencias'
  | 'creditos'
  | 'total_efectivo'
  | 'efectivo_recibido'
  | 'cambio_entregado'
  | 'devoluciones_efectivo'
  | 'depositos_bancarios'
> & {
  fondo_inicial?: number;
  desglose_billetes?: Partial<DesgloseBilletes>;
  otros_motivos?: { monto: number; tipo: string }[];
};

interface PagoResumen {
  _id: Types.ObjectId;
  moneda?: unknown;
  metodoPago?: string;
  esCuentaCasa?: boolean;
}

export interface ResumenDiario {
  fecha: string;
  cantidad_ventas: number;
  total_ventas_dia: number;
  total_efectivo: number;
  valor_transferencias: number;
  total_creditos: number;
  descuentos: number;
  total_extracciones_dia: number;
  /** Moneda de las cifras anteriores. */
  moneda: string;
  /** Turno abierto del empleado, si lo tiene. */
  turnoCajaId: string | null;
  fondo_inicial: number;
  depositos_bancarios: number;
  devoluciones_efectivo: number;
}
