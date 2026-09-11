import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { CreateCompraDto } from './dto/create-compra.dto';
import { UpdateCompraDto } from './dto/update-compra.dto';
import { Compra, CompraDocument, Pago } from './schema/compra.schema';
import { Producto } from '../../inventario/producto/schemas/producto.schema';
import { Kardex, KardexTipo } from '../../inventario/kardex/schema/kardex.schema';
import {
  CuentaPagar,
  CuentaPagarDocument,
} from '../../finanzas/cuenta-pagar/schema/cuenta-pagar.schema';
import { EstadoCxP } from '../../finanzas/cuenta-pagar/types/cuenta-pagar.types';
import {
  Comprobante,
  ComprobanteDocument,
  LineaComprobante,
} from '../../contabilidad/comprobante/schema/comprobante.schema';
import { Cuenta, CuentaDocument } from '../../contabilidad/cuenta/schema/cuenta.schema';
import { NomencladorHelper } from '../../configuracion/nomenclador-helper/nomenclador-helper.service';

/**
 * Línea interna para construir Comprobantes automáticos.
 * No se exporta; vive sólo dentro del CompraService.
 */
interface LineaComprobanteInput {
  cuentaId: Types.ObjectId;
  cuentaNombre: string;
  debe: number;
  haber: number;
  descripcion?: string;
}

/**
 * Subset de Cuenta que CompraService necesita para construir líneas de
 * Comprobante. Evita devolver el documento completo cuando sólo se usan
 * dos campos.
 */
interface CuentaContableBasica {
  _id: Types.ObjectId;
  nombre: string;
}

@Injectable()
export class CompraService {
  private readonly logger = new Logger(CompraService.name);

  // Códigos de cuentas contables que el CompraService necesita para los
  // Comprobantes automáticos. Si las cuentas no existen en la BD, los
  // comprobantes no se generan (se loggea warning y la compra sigue OK).
  // Convención documentada en el Word de anotaciones.
  private static readonly COD_CUENTA_INVENTARIO = 'INVENTARIO';
  private static readonly COD_CUENTA_TRANSITORIA = 'TRANSITORIA_SUBSISTEMA';
  private static readonly COD_CUENTA_CXP = 'CUENTAS_POR_PAGAR';
  private static readonly COD_CUENTA_CAJA = 'CAJA';

  constructor(
    @InjectModel(Compra.name) private compraModel: Model<CompraDocument>,
    @InjectModel(Producto.name) private productoModel: Model<Producto>,
    @InjectModel(Kardex.name) private kardexModel: Model<Kardex>,
    @InjectModel(CuentaPagar.name) private cxpModel: Model<CuentaPagarDocument>,
    @InjectModel(Comprobante.name)
    private comprobanteModel: Model<ComprobanteDocument>,
    @InjectModel(Cuenta.name) private cuentaModel: Model<CuentaDocument>,
    private readonly nomencladorHelper: NomencladorHelper,
  ) { }

  private normalizeRate(r?: number): number {
    if (!r) return 0;
    return r > 1 ? r / 100 : r; // if user passed 5 assume 5%
  }

  private calculateRecargo(dto: CreateCompraDto): number {
    const tasaCentral = this.normalizeRate(dto.tasaBancoCentral);
    const tasaInformal = this.normalizeRate(dto.tasaBancoInformal);
    const fluctuacion = this.normalizeRate(dto.fluctuacion);

    const base = (dto.subtotalCompra || 0) - (dto.descuentoTotal || 0);
    let recargo = 0;

    if (dto.modoPago === Pago.EFECTIVO) recargo += 0;
    else if (dto.modoPago === Pago.TRANSFERENCIA) recargo += base * tasaCentral;
    else if (dto.modoPago === Pago.CREDITO) recargo += base * tasaInformal;

    if (fluctuacion) recargo += base * fluctuacion;

    return Math.round((recargo + Number.EPSILON) * 100) / 100;
  }

  private calcularMontoTotal(dto: CreateCompraDto): number {
    const subtotal = dto.subtotalCompra || 0;
    const descuento = dto.descuentoTotal || 0;
    const recargo = dto.recargo || 0;
    return Math.round((subtotal - descuento + recargo + Number.EPSILON) * 100) / 100;
  }

  private async generarCodigoCxP(_compraId: string): Promise<string> {
    const short = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `CXP-${Date.now()}-${short}`;
  }

  private async generarNumeroComprobante(): Promise<string> {
    const short = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `COMP-${Date.now()}-${short}`;
  }

  private async buscarCuentaPorCodigo(
    codigo: string,
  ): Promise<CuentaContableBasica | null> {
    const c = await this.cuentaModel.findOne({ codigo }).exec();
    return c ? { _id: c._id as Types.ObjectId, nombre: c.nombre } : null;
  }

  /**
   * Crea un Comprobante contable. Si las líneas no están equilibradas
   * (debe ≠ haber), loggea warning y NO crea el comprobante.
   * Devuelve el documento creado o null si no se pudo crear.
   */
  private async crearComprobante(
    fecha: Date,
    concepto: string,
    lineas: LineaComprobanteInput[],
    tipoComprobanteCodigo?: string,
  ): Promise<Comprobante | null> {
    const totalDebito = Number(
      lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0).toFixed(2),
    );
    const totalCredito = Number(
      lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0).toFixed(2),
    );
    const equilibrado = Math.abs(totalDebito - totalCredito) < 0.01;
    if (!equilibrado) {
      this.logger.warn(
        `Comprobante no equilibrado: debe=${totalDebito}, haber=${totalCredito}, concepto="${concepto}". Se omite.`,
      );
      return null;
    }

    const lineasDoc: LineaComprobante[] = lineas.map((l) => ({
      cuentaId: l.cuentaId,
      cuentaNombre: l.cuentaNombre,
      debe: l.debe,
      haber: l.haber,
      descripcion: l.descripcion,
    }));

    let tipoId: Types.ObjectId | undefined;
    if (tipoComprobanteCodigo) {
      try {
        tipoId = await this.nomencladorHelper.findOrCreateComprobanteTipo(
          tipoComprobanteCodigo,
        );
      } catch (err) {
        this.logger.warn(
          `No se pudo resolver tipo de comprobante "${tipoComprobanteCodigo}": ${(err as Error).message}`,
        );
      }
    }

    const numero = await this.generarNumeroComprobante();
    const doc = await this.comprobanteModel.create({
      fecha,
      numero,
      concepto,
      lineas: lineasDoc,
      totalDebito,
      totalCredito,
      equilibrado: true,
      tipo: tipoId,
    });
    return doc;
  }

  /**
   * Genera los 2 Comprobantes automáticos asociados a una compra.
   * - Comprobante 1: Inventario (debe) vs Transitoria de Subsistema (haber).
   * - Comprobante 2 (depende del modo de pago):
   *     - CREDITO:            Transitoria (debe) vs Cuentas por Pagar (haber).
   *     - EFECTIVO/TRANSFER:  Transitoria (debe) vs Caja (haber).
   *
   * Si alguna cuenta requerida no existe, se loggea warning y se omite
   * el comprobante correspondiente. La compra se guarda igual.
   */
  private async generarComprobantesAutomaticos(
    compra: CompraDocument,
    montoTotal: number,
  ): Promise<void> {
    try {
      const cuentaInventario = await this.buscarCuentaPorCodigo(
        CompraService.COD_CUENTA_INVENTARIO,
      );
      const cuentaTransitoria = await this.buscarCuentaPorCodigo(
        CompraService.COD_CUENTA_TRANSITORIA,
      );

      if (!cuentaInventario || !cuentaTransitoria) {
        this.logger.warn(
          `Compra ${compra._id}: cuentas INVENTARIO o TRANSITORIA_SUBSISTEMA no existen. No se generan Comprobantes automáticos.`,
        );
        return;
      }

      const concepto1 = `Compra ${compra._id} - Ingreso a inventario`;
      await this.crearComprobante(
        new Date(),
        concepto1,
        [
          {
            cuentaId: cuentaInventario._id,
            cuentaNombre: cuentaInventario.nombre,
            debe: montoTotal,
            haber: 0,
            descripcion: 'Inventario por compra',
          },
          {
            cuentaId: cuentaTransitoria._id,
            cuentaNombre: cuentaTransitoria.nombre,
            debe: 0,
            haber: montoTotal,
            descripcion: 'Subsistema transitorio',
          },
        ],
        'COMPRA_INVENTARIO',
      );

      const concepto2 = `Compra ${compra._id} - Liquidación`;
      if (compra.modoPago === Pago.CREDITO) {
        const cuentaCxp = await this.buscarCuentaPorCodigo(
          CompraService.COD_CUENTA_CXP,
        );
        if (!cuentaCxp) {
          this.logger.warn(
            `Compra ${compra._id}: cuenta CUENTAS_POR_PAGAR no existe. No se genera comprobante 2.`,
          );
          return;
        }
        await this.crearComprobante(
          new Date(),
          concepto2,
          [
            {
              cuentaId: cuentaTransitoria._id,
              cuentaNombre: cuentaTransitoria.nombre,
              debe: montoTotal,
              haber: 0,
              descripcion: 'Cancelación transitoria',
            },
            {
              cuentaId: cuentaCxp._id,
              cuentaNombre: cuentaCxp.nombre,
              debe: 0,
              haber: montoTotal,
              descripcion: 'CxP generada',
            },
          ],
          'COMPRA_CREDITO',
        );
      } else {
        const cuentaCaja = await this.buscarCuentaPorCodigo(
          CompraService.COD_CUENTA_CAJA,
        );
        if (!cuentaCaja) {
          this.logger.warn(
            `Compra ${compra._id}: cuenta CAJA no existe. No se genera comprobante 2.`,
          );
          return;
        }
        await this.crearComprobante(
          new Date(),
          concepto2,
          [
            {
              cuentaId: cuentaTransitoria._id,
              cuentaNombre: cuentaTransitoria.nombre,
              debe: montoTotal,
              haber: 0,
              descripcion: 'Cancelación transitoria',
            },
            {
              cuentaId: cuentaCaja._id,
              cuentaNombre: cuentaCaja.nombre,
              debe: 0,
              haber: montoTotal,
              descripcion: `Pago en ${compra.modoPago}`,
            },
          ],
          'COMPRA_CONTADO',
        );
      }
    } catch (err) {
      this.logger.warn(
        `No se pudieron generar Comprobantes automáticos para la compra ${compra._id}: ${(err as Error).message}`,
      );
    }
  }

  async create(createCompraDto: CreateCompraDto): Promise<CompraDocument> {
    if (createCompraDto.recargo === undefined || createCompraDto.recargo === null) {
      createCompraDto.recargo = this.calculateRecargo(createCompraDto);
    }

    for (const item of createCompraDto.productos) {
      const producto = await this.productoModel.findById(item.productoId);
      if (!producto) {
        throw new NotFoundException(`Producto con ID ${item.productoId} no encontrado`);
      }

      producto.stock_inicial += item.cantidad;
      await producto.save();

      await this.kardexModel.create({
        productoId: producto._id,
        tipo: KardexTipo.COMPRA,
        cantidad: item.cantidad,
        stock: producto.stock_inicial,
        motivo: 'Compra',
      });
    }

    const created = new this.compraModel(
      createCompraDto as unknown as Compra,
    );
    const compraGuardada = await created.save();

    const montoTotal = this.calcularMontoTotal(createCompraDto);

    if (compraGuardada.modoPago === Pago.CREDITO) {
      try {
        const codigo = await this.generarCodigoCxP(compraGuardada._id.toString());
        const fechaEmision = new Date();
        const fechaVencimiento = new Date(fechaEmision);
        fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);

        await this.cxpModel.create({
          codigo,
          proveedor: createCompraDto.empresa,
          montoOriginal: montoTotal,
          saldoPendiente: montoTotal,
          fechaEmision,
          fechaVencimiento,
          estado: EstadoCxP.PENDIENTE,
          notas: `Generada desde compra ${compraGuardada._id}`,
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo generar la CuentaPagar para la compra ${compraGuardada._id}: ${(error as Error).message}`,
        );
      }
    }

    // Generar los 2 Comprobantes automáticos (DESPUÉS de la CxP).
    await this.generarComprobantesAutomaticos(compraGuardada, montoTotal);

    return compraGuardada;
  }

  async findAll(): Promise<CompraDocument[]> {
    return this.compraModel.find().exec();
  }

  async findOne(id: string): Promise<CompraDocument> {
    if (!isValidObjectId(id)) throw new NotFoundException('Compra no encontrada');
    const doc = await this.compraModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Compra no encontrada');
    return doc;
  }

  async update(
    id: string,
    updateCompraDto: UpdateCompraDto,
  ): Promise<CompraDocument> {
    if (!isValidObjectId(id)) throw new NotFoundException('Compra no encontrada');
    // if recargo is not provided but payment/ratess/amount changed, recalculate
    if (updateCompraDto.recargo === undefined || updateCompraDto.recargo === null) {
      // need base fields to compute recargo — fetch existing and merge
      const existing = await this.compraModel.findById(id).lean().exec();
      if (!existing) throw new NotFoundException('Compra no encontrada');
      const merged = { ...existing, ...updateCompraDto } as unknown as CreateCompraDto;
      const computed = this.calculateRecargo(merged);
      updateCompraDto.recargo = computed;
    }

    const updated = await this.compraModel
      .findByIdAndUpdate(
        id,
        updateCompraDto as unknown as Compra,
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('Compra no encontrada');
    return updated;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    if (!isValidObjectId(id)) throw new NotFoundException('Compra no encontrada');
    const removed = await this.compraModel.findByIdAndDelete(id).exec();
    if (!removed) throw new NotFoundException('Compra no encontrada');
    return { deleted: true };
  }
}
