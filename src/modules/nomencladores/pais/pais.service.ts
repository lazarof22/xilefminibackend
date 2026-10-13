import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePaiDto } from './dto/create-pai.dto';
import { UpdatePaiDto } from './dto/update-pai.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Pais } from './schema/pais.schema';
import { Ciudad } from '../ciudad/schema/ciudad.schema';
import { normalizeName } from '../shared/nomenclador-utils';

@Injectable()
export class PaisService {
  constructor(
    @InjectModel(Pais.name) private paisModel: Model<Pais>,
    @InjectModel(Ciudad.name) private ciudadModel: Model<Ciudad>,
  ) {}

  async findOrCreate(nombre: string): Promise<Types.ObjectId> {
    const normalized = normalizeName(nombre);
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let doc = await this.paisModel
      .findOne({ nombrePais: { $regex: new RegExp('^' + escaped + '$', 'i') } })
      .exec();
    if (!doc) {
      doc = await this.paisModel.create({ nombrePais: normalized });
    }
    return doc._id as Types.ObjectId;
  }

  //Crear un pais
  async create(createPaiDto: CreatePaiDto): Promise<Pais> {
    const nombrePais = normalizeName(createPaiDto.nombrePais);
    const escaped = nombrePais.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existP = await this.paisModel.findOne({
      nombrePais: { $regex: new RegExp('^' + escaped + '$', 'i') },
    });
    if (existP) {
      throw new BadRequestException('Ya existe el pais');
    }
    const nuevoPais = new this.paisModel({ nombrePais });
    return nuevoPais.save();
  }

  //Buscar todos los paises
  async findAll(): Promise<Pais[]> {
    return this.paisModel.find().sort({ createdAt: -1 }).exec();
  }

  // Buscar un pais
  async findOne(id: string): Promise<Pais> {
    const pais = await this.paisModel.findById(id).exec();
    if (!pais) {
      throw new NotFoundException('No se encontró el pais');
    }
    return pais;
  }

  //Actualizar un pais
  async update(id: string, UpdateMonedaDto: UpdatePaiDto): Promise<Pais> {
    const updatep = await this.paisModel
      .findByIdAndUpdate(id, UpdateMonedaDto, { new: true })
      .exec();

    if (!updatep) {
      throw new NotFoundException('No se encontró el pais');
    }
    return updatep;
  }

  //Eliminar un pais

  async remove(id: string): Promise<void> {
    if (
      Types.ObjectId.isValid(id) &&
      (await this.ciudadModel.exists({ pais: new Types.ObjectId(id) }))
    ) {
      throw new BadRequestException(
        'No se puede eliminar el país porque tiene ciudades asociadas',
      );
    }
    const deletep = await this.paisModel.findByIdAndDelete(id);

    if (!deletep) {
      throw new NotFoundException('No se encontró el país');
    }
  }
}
