import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { CreateCompraDto } from './dto/create-compra.dto';
import { UpdateCompraDto } from './dto/update-compra.dto';
import { Compra, CompraDocument } from './schema/compra.schema';
import {
  Empresa,
  EmpresaDocument,
  tipoEmpresa,
} from '../../clientes y provedores/empresa/schema/empresa.schema';

const MONEDA_LOCAL = 'CUP';

const redondear = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class CompraService {
  constructor(
    @InjectModel(Compra.name) private compraModel: Model<CompraDocument>,
    @InjectModel(Empresa.name) private empresaModel: Model<EmpresaDocument>,
  ) {}

  /**
   * Decide qué tasa aplica y descarta la otra:
   *  - Moneda CUP: ninguna.
   *  - Proveedor Mypime: tasa de mercado informal.
   *  - Cualquier otro proveedor: tasa del banco nacional.
   */
  private async resolverTasas(datos: {
    moneda: string;
    nombreProveedor: string;
    tasaMercadoInformal?: number | null;
    tasaBancoNacional?: number | null;
  }): Promise<{ tasaMercadoInformal?: number; tasaBancoNacional?: number }> {
    if (datos.moneda.trim().toUpperCase() === MONEDA_LOCAL) return {};

    const proveedor = await this.empresaModel
      .findOne({ nombreEmpresa: datos.nombreProveedor })
      .lean()
      .exec();
    if (!proveedor) {
      throw new BadRequestException(
        `El proveedor "${datos.nombreProveedor}" no existe`,
      );
    }

    if (proveedor.tipoEmpresa === tipoEmpresa.MYPIME) {
      if (!datos.tasaMercadoInformal || datos.tasaMercadoInformal <= 0) {
        throw new BadRequestException(
          'Indique la tasa de cambio del mercado informal (el proveedor es Mypime)',
        );
      }
      return { tasaMercadoInformal: datos.tasaMercadoInformal };
    }

    if (!datos.tasaBancoNacional || datos.tasaBancoNacional <= 0) {
      throw new BadRequestException(
        'Indique la tasa de cambio del banco nacional (el proveedor no es Mypime)',
      );
    }
    return { tasaBancoNacional: datos.tasaBancoNacional };
  }

  async create(dto: CreateCompraDto): Promise<CompraDocument> {
    const tasas = await this.resolverTasas(dto);

    return this.compraModel.create({
      numeroFactura: dto.numeroFactura,
      nombreProveedor: dto.nombreProveedor,
      nombreProducto: dto.nombreProducto,
      fechaCompra: new Date(dto.fechaCompra),
      moneda: dto.moneda,
      ...tasas,
      precioCompra: dto.precioCompra,
      cantidad: dto.cantidad,
      iva: dto.iva,
      totalPagado: redondear(dto.precioCompra * dto.cantidad),
      metodoPago: dto.metodoPago,
    });
  }

  async findAll(): Promise<CompraDocument[]> {
    return this.compraModel
      .find()
      .sort({ fechaCompra: -1, createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<CompraDocument> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Compra no encontrada');
    const doc = await this.compraModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Compra no encontrada');
    return doc;
  }

  async update(id: string, dto: UpdateCompraDto): Promise<CompraDocument> {
    const doc = await this.findOne(id);

    // Se valida el resultado final (lo guardado + los cambios), no solo el parche.
    const moneda = dto.moneda ?? doc.moneda;
    const nombreProveedor = dto.nombreProveedor ?? doc.nombreProveedor;
    const cambiaContexto =
      dto.moneda !== undefined || dto.nombreProveedor !== undefined;
    const tasas = await this.resolverTasas({
      moneda,
      nombreProveedor,
      // Si cambió la moneda o el proveedor, la tasa guardada ya no vale: hay que enviarla.
      tasaMercadoInformal:
        dto.tasaMercadoInformal ??
        (cambiaContexto ? undefined : doc.tasaMercadoInformal),
      tasaBancoNacional:
        dto.tasaBancoNacional ??
        (cambiaContexto ? undefined : doc.tasaBancoNacional),
    });

    const precioCompra = dto.precioCompra ?? doc.precioCompra;
    const cantidad = dto.cantidad ?? doc.cantidad;

    doc.set({
      numeroFactura: dto.numeroFactura ?? doc.numeroFactura,
      nombreProveedor,
      nombreProducto: dto.nombreProducto ?? doc.nombreProducto,
      fechaCompra: dto.fechaCompra
        ? new Date(dto.fechaCompra)
        : doc.fechaCompra,
      moneda,
      tasaMercadoInformal: tasas.tasaMercadoInformal,
      tasaBancoNacional: tasas.tasaBancoNacional,
      precioCompra,
      cantidad,
      iva: dto.iva ?? doc.iva,
      totalPagado: redondear(precioCompra * cantidad),
      metodoPago: dto.metodoPago ?? doc.metodoPago,
    });
    return doc.save();
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Compra no encontrada');
    const removed = await this.compraModel.findByIdAndDelete(id).exec();
    if (!removed) throw new NotFoundException('Compra no encontrada');
    return { deleted: true };
  }
}
