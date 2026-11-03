import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateKardexDto } from './dto/create-kardex.dto';
import { UpdateKardexDto } from './dto/update-kardex.dto';
import { Kardex, KardexTipo } from './schema/kardex.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Producto } from '../producto/schemas/producto.schema';
import { NomencladorHelper } from '../../configuracion/nomenclador-helper/nomenclador-helper.service';
import { ExistenciaService } from '../exitencia/existencia.service';
import { ResultadoMovimiento } from '../exitencia/existencia.types';

export interface KardexResultadoMensaje {
  message: string;
}

@Injectable()
export class KardexService {
  constructor(
    @InjectModel(Kardex.name) private kardexModel: Model<Kardex>,
    @InjectModel(Producto.name) private productoModel: Model<Producto>,
    private readonly nomencladorHelper: NomencladorHelper,
    private readonly existenciaService: ExistenciaService,
  ) {}

  /**
   * Si el nuevo stock del producto llega a 0, cambia su estado al nomenclador
   * "Inactivo" (creándolo si no existe). Decisión conservadora: NO vuelve a
   * "Activo" automáticamente aunque el stock vuelva a ser positivo.
   *
   * Esta lógica evita inyección circular: KardexService accede directo al
   * productoModel + NomencladorHelper, sin pasar por ProductoService.
   */
  private async inactivarProductoSiStockCero(
    productoId: Types.ObjectId,
    nuevoStock: number,
  ): Promise<void> {
    if (nuevoStock > 0) return;
    try {
      const estadoInactivo = await this.nomencladorHelper.findOrCreateEstado(
        'Inactivo',
      );
      const producto = await this.productoModel.findById(productoId);
      if (!producto) return;
      if (producto.estado?.toString() === estadoInactivo.toString()) return;
      await this.productoModel.findByIdAndUpdate(productoId, {
        estado: estadoInactivo,
      });
    } catch (err) {
      // No romper la operación principal si falla el auto-estado.
      // eslint-disable-next-line no-console
      console.warn(
        `Kardex: no se pudo actualizar estado del producto ${productoId}: ${(err as Error).message}`,
      );
    }
  }

  //Crear un kardex y actualizar el stock del producto
  async create(
    createKardexDto: CreateKardexDto,
  ): Promise<Kardex> {
    const { productoId, tipo, cantidad, motivo } = createKardexDto;

    if (!Types.ObjectId.isValid(productoId)) {
      throw new BadRequestException('El ID del producto no es válido');
    }
    const producto = await this.productoModel.findById(productoId);

    if (!producto) {
      throw new NotFoundException('No se encontró el producto');
    }

    if (cantidad <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }

    // Modo unificado (Fase 1): el ajuste mueve `Existencia`, no solo el total.
    if (await this.existenciaService.estaUnificado()) {
      return this.crearUnificado(createKardexDto);
    }

    if (tipo === KardexTipo.SALIDA && producto.stock_inicial < cantidad) {
      throw new BadRequestException('Stock insuficiente');
    }

    const nuevoStock = tipo === KardexTipo.ENTRADA ? producto.stock_inicial + cantidad : producto.stock_inicial - cantidad;

    const [productoAct, kardexCreado] = await Promise.all([
      this.productoModel.findByIdAndUpdate(productoId, { stock_inicial: nuevoStock }, { new: true }),
      this.kardexModel.create({
        productoId: new Types.ObjectId(productoId),
        tipo,
        cantidad,
        stock: nuevoStock,
        motivo
      })
    ]);

    await this.inactivarProductoSiStockCero(
      new Types.ObjectId(productoId),
      nuevoStock,
    );

    return kardexCreado;
  }



  /**
   * Ajuste manual en modo unificado: una entrada suma a una ubicación y una
   * salida resta de las ubicaciones del producto (o de la indicada). Solo
   * se admiten ENTRADA y SALIDA: los demás tipos los escribe cada módulo
   * junto con su propio movimiento. Si el kardex no se puede guardar, el
   * movimiento de stock se deshace (un ajuste sin su kardex sería silencioso).
   */
  private async crearUnificado(
    createKardexDto: CreateKardexDto,
  ): Promise<Kardex> {
    const { productoId, tipo, cantidad, motivo, almacenId, contenedorId } =
      createKardexDto;

    if (tipo !== KardexTipo.ENTRADA && tipo !== KardexTipo.SALIDA) {
      throw new BadRequestException(
        'En el modo unificado solo se registran manualmente entradas y salidas (ajustes de inventario)',
      );
    }

    const movimiento: ResultadoMovimiento =
      tipo === KardexTipo.ENTRADA
        ? await this.existenciaService.reponerProducto({
            productoId,
            cantidad,
            almacenId,
            contenedorId,
          })
        : await this.existenciaService.descontarProducto({
            productoId,
            cantidad,
            almacenId,
            contenedorId,
          });

    let kardexCreado: Kardex;

    try {
      kardexCreado = await this.kardexModel.create({
        productoId: new Types.ObjectId(productoId),
        tipo,
        cantidad,
        stock: movimiento.stockTotal,
        motivo,
      });
    } catch (error) {
      await this.deshacerMovimiento(tipo, productoId, movimiento);
      throw error;
    }

    await this.inactivarProductoSiStockCero(
      new Types.ObjectId(productoId),
      movimiento.stockTotal,
    );

    return kardexCreado;
  }

  /** Revierte el movimiento de stock de un ajuste cuyo kardex no se guardó. */
  private async deshacerMovimiento(
    tipo: KardexTipo,
    productoId: string,
    movimiento: ResultadoMovimiento,
  ): Promise<void> {
    try {
      if (tipo === KardexTipo.SALIDA) {
        await this.existenciaService.reponerProducto({
          productoId,
          ubicaciones: movimiento.ubicaciones,
        });
        return;
      }
      for (const u of movimiento.ubicaciones) {
        await this.existenciaService.descontarProducto({
          productoId,
          cantidad: u.cantidad,
          almacenId: u.almacen,
          contenedorId: u.contenedor,
        });
      }
    } catch (error) {
      console.error(
        `Kardex: no se pudo deshacer el ajuste de ${productoId} tras fallar su registro, corregir a mano: ${(error as Error).message}`,
      );
    }
  }

  //Buscar todos los kardex
  async findAll(): Promise<Kardex[]> {
    return this.kardexModel
      .find()
      .populate({ path: 'productoId', select: 'nombre_producto' })
      .sort({ fecha: -1, _id: -1 })
      .exec();
  }

  //Buscar todos los kardex de tipo salida
  async findAllSalidas(): Promise<Kardex[]> {
    return this.kardexModel
      .find({ tipo: KardexTipo.SALIDA })
      .populate({ path: 'productoId', select: 'nombre_producto' })
      .sort({ fecha: -1, _id: -1 })
      .exec();
  }

  //Buscar un solo kardex
  async findOne(id: string): Promise<Kardex> {
    const kar = await this.kardexModel
      .findById(id)
      .populate({ path: 'productoId', select: 'nombre_producto' })
      .exec();

    if (!kar) {
      throw new NotFoundException('No se encontró el kardex');
    }

    return kar;
  }



  //Actualizar un kardex
  async update(id: string, updateKardexDto: UpdateKardexDto): Promise<Kardex | KardexResultadoMensaje> {
    const { cantidad: nuevaCantidad } = updateKardexDto;

    // Un movimiento ya registrado no se edita en el modo unificado: el saldo
    // está repartido por ubicación y el kardex es la evidencia. Se corrige
    // con un nuevo ajuste.
    if (await this.existenciaService.estaUnificado()) {
      throw new BadRequestException(
        'En el modo unificado los movimientos de kardex no se modifican; registre un ajuste de inventario',
      );
    }

    const kardexExistente = await this.kardexModel.findById(id);
    if (!kardexExistente) {
      throw new NotFoundException('El kardex no existe');
    }

    const producto = await this.productoModel.findById(kardexExistente.productoId);
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    const nuevoStock = kardexExistente.tipo === KardexTipo.ENTRADA ? producto.stock_inicial + nuevaCantidad : producto.stock_inicial - nuevaCantidad;

    if (nuevoStock < 0) {
      return { message: 'Stock insuficiente para la actualización' };
    }

    const [productoActualizado, kardexActualizado] = await Promise.all([
      this.productoModel.findByIdAndUpdate(kardexExistente.productoId, { stock_inicial: nuevoStock }, { new: true }),
      this.kardexModel.findByIdAndUpdate(id, { cantidad: nuevaCantidad }, { new: true })
    ]);
    if (!kardexActualizado) {
      return { message: 'Error al actualizar el kardex' };
    }

    await this.inactivarProductoSiStockCero(
      new Types.ObjectId(kardexExistente.productoId.toString()),
      nuevoStock,
    );

    return kardexActualizado;
  }



  //Eliminar un kardex

  async remove(id: string): Promise<KardexResultadoMensaje> {
    const deletekar = await this.kardexModel.findByIdAndDelete(id);

    if (!deletekar) {
      throw new NotFoundException('El kardex no existe');
    }
    return { message: "El kardex se elimino correctamente" };
  }
}