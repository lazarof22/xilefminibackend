import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { CreateExtraccionDto } from './dto/create-extraccion.dto';
import { Extraccion, ExtraccionDocument } from './schema/extraccion.schema';
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';

@Injectable()
export class ExtraccionService {
  constructor(
    @InjectModel(Extraccion.name)
    private extraccionModel: Model<ExtraccionDocument>,
    @InjectModel(TurnoCaja.name) private turnoModel: Model<TurnoCaja>,
  ) {}

  /**
   * `cajeroId` (usuario autenticado, si lo hay) vincula la extracción a su
   * turno abierto. Sin usuario o sin turno abierto la extracción se guarda
   * igual, con `turnoCaja` sin definir.
   */
  async create(
    dto: CreateExtraccionDto,
    cajeroId?: string,
  ): Promise<Extraccion> {
    if (dto.monto <= 0) {
      throw new BadRequestException('El monto debe ser mayor que cero');
    }

    const cajero =
      cajeroId && isValidObjectId(cajeroId)
        ? new Types.ObjectId(cajeroId)
        : undefined;
    const turno = cajero
      ? ((await this.turnoModel
          .findOne({ cajeroId: cajero, estado: EstadoTurnoCaja.ABIERTO })
          .select('_id')
          .lean()
          .exec()) as unknown as { _id: Types.ObjectId } | null)
      : null;

    const extraccion = new this.extraccionModel({
      monto: dto.monto,
      causa: dto.causa,
      fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
      responsable: dto.responsable,
      moneda: dto.moneda?.trim() || 'CUP',
      empleadoId: cajero,
      turnoCaja: turno?._id,
    });

    return extraccion.save();
  }

  async findAll(): Promise<Extraccion[]> {
    return this.extraccionModel.find().sort({ fecha: -1 }).exec();
  }

  async findOne(id: string): Promise<Extraccion> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Extracción no encontrada');
    const doc = await this.extraccionModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Extracción no encontrada');
    return doc;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Extracción no encontrada');
    const removed = await this.extraccionModel.findByIdAndDelete(id).exec();
    if (!removed) throw new NotFoundException('Extracción no encontrada');
    return { deleted: true };
  }
}
