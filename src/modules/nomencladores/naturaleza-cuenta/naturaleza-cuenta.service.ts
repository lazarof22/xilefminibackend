import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateNaturalezaCuentaDto } from './dto/create-naturaleza-cuenta.dto';
import { UpdateNaturalezaCuentaDto } from './dto/update-naturaleza-cuenta.dto';
import { InjectModel } from '@nestjs/mongoose';
import { NaturalezaCuenta } from './schema/naturaleza-cuenta.schema';
import { Model, Types } from 'mongoose';
import { normalizeName } from '../shared/nomenclador-utils';

@Injectable()
export class NaturalezaCuentaService {
  constructor(
    @InjectModel(NaturalezaCuenta.name)
    private naturalezaCuentaModel: Model<NaturalezaCuenta>,
  ) {}

  async findOrCreate(nombre: string): Promise<Types.ObjectId> {
    const normalized = normalizeName(nombre);
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let doc = await this.naturalezaCuentaModel
      .findOne({ nombre: { $regex: new RegExp('^' + escaped + '$', 'i') } })
      .exec();
    if (!doc) {
      doc = await this.naturalezaCuentaModel.create({ nombre: normalized });
    }
    return doc._id as Types.ObjectId;
  }

  async create(
    createNaturalezaCuentaDto: CreateNaturalezaCuentaDto,
  ): Promise<NaturalezaCuenta> {
    const exist = await this.naturalezaCuentaModel.findOne({
      nombre: createNaturalezaCuentaDto.nombre,
    });

    if (exist) {
      throw new BadRequestException('Ya existe la naturaleza de cuenta');
    }
    const nuevo = new this.naturalezaCuentaModel(createNaturalezaCuentaDto);
    return nuevo.save();
  }

  async findAll(): Promise<NaturalezaCuenta[]> {
    return this.naturalezaCuentaModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<NaturalezaCuenta> {
    const item = await this.naturalezaCuentaModel.findById(id).exec();
    if (!item) {
      throw new NotFoundException('No se encontró la naturaleza de cuenta');
    }
    return item;
  }

  async update(
    id: string,
    updateNaturalezaCuentaDto: UpdateNaturalezaCuentaDto,
  ): Promise<NaturalezaCuenta> {
    const item = await this.naturalezaCuentaModel
      .findByIdAndUpdate(id, updateNaturalezaCuentaDto, { new: true })
      .exec();

    if (!item) {
      throw new NotFoundException('No se encontró la naturaleza de cuenta');
    }
    return item;
  }

  async remove(id: string): Promise<void> {
    const item = await this.naturalezaCuentaModel.findByIdAndDelete(id);

    if (!item) {
      throw new NotFoundException('No se encontró la naturaleza de cuenta');
    }
  }
}
