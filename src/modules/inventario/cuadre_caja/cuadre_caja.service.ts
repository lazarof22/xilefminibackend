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
import { Model, Types, UpdateQuery } from 'mongoose';

@Injectable()
export class CuadreCajaService {
  constructor(
    @InjectModel(CuadreCaja.name) private cuadreCajaModel: Model<CuadreCaja>,
    @InjectModel(Usuarios.name) private usuarioModel: Model<Usuarios>,
    @InjectModel(Venta.name) private ventaModel: Model<Venta>,
    @InjectModel(Pago.name) private pagoModel: Model<Pago>,
    @InjectModel(Extraccion.name)
    private extraccionModel: Model<Extraccion>,
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
    const nuevoCuadre = new this.cuadreCajaModel({
      ...createCuadreCajaDto,
      creditos: createCuadreCajaDto.creditos ?? 0,
      otros_motivos: otros,
      ...this.calcular({ ...createCuadreCajaDto, otros_motivos: otros }),
    });
    return nuevoCuadre.save();
  }

  /**
   * Efectivo esperado en caja:
   * ventas netas (ya incluyen descuentos e impuestos) + recargos
   * - extracciones - transferencias - créditos ± otros motivos.
   * `descuentos` es informativo porque ya está restado en `total_ventas_dia`.
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
      (datos.total_ventas_dia || 0) +
        (datos.recargos || 0) -
        (datos.total_extracciones_dia || 0) -
        (datos.valor_transferencias || 0) -
        (datos.creditos || 0) +
        otros,
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
      otros_motivos: updateCuadreCajaDto.otros_motivos ?? actual.otros_motivos,
      desglose_billetes: desglose,
      total_efectivo: totalEfectivo,
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
  async getResumenDiario(fecha?: string): Promise<ResumenDiario> {
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

    for (const venta of ventas) {
      const total = this.totalVenta(venta);
      totalVentas += total;
      totalDescuentos += venta.descuento_total || 0;

      const pago = pagosPorId.get(String(venta.pago));
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
    const totalExtracciones = extracciones.reduce(
      (sum, e) => sum + (e.monto || 0),
      0,
    );

    return {
      fecha: fechaDia,
      cantidad_ventas: ventas.length,
      total_ventas_dia: this.redondear(totalVentas),
      total_efectivo: this.redondear(totalEfectivo),
      valor_transferencias: this.redondear(totalTransferencias),
      total_creditos: this.redondear(totalCreditos),
      descuentos: this.redondear(totalDescuentos),
      total_extracciones_dia: this.redondear(totalExtracciones),
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
> & {
  desglose_billetes?: Partial<DesgloseBilletes>;
  otros_motivos?: { monto: number; tipo: string }[];
};

interface PagoResumen {
  _id: Types.ObjectId;
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
}
