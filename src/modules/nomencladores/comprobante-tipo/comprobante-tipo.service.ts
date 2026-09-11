import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { CreateComprobanteTipoDto } from './dto/create-comprobante-tipo.dto';
import { UpdateComprobanteTipoDto } from './dto/update-comprobante-tipo.dto';
import {
  ComprobanteTipo,
  ComprobanteTipoDocument,
} from './schema/comprobante-tipo.schema';

@Injectable()
export class ComprobanteTipoService {
  constructor(
    @InjectModel(ComprobanteTipo.name)
    private comprobanteTipoModel: Model<ComprobanteTipoDocument>,
  ) {}

  /**
   * Devuelve el ObjectId de un tipo de comprobante buscándolo por código.
   * Si no existe, lo crea con `codigo` y `nombre` iguales (en mayúsculas).
   * Patrón equivalente al `findOrCreate` de ElementoGasto / Estado / etc.
   */
  async findOrCreate(codigo: string): Promise<Types.ObjectId> {
    const normalized = codigo.trim().toUpperCase();
    let doc = await this.comprobanteTipoModel
      .findOne({ codigo: normalized })
      .exec();
    if (!doc) {
      doc = await this.comprobanteTipoModel.create({
        codigo: normalized,
        nombre: normalized,
      });
    }
    return doc._id as Types.ObjectId;
  }

  async create(createDto: CreateComprobanteTipoDto): Promise<ComprobanteTipo> {
    const existente = await this.comprobanteTipoModel
      .findOne({ codigo: createDto.codigo })
      .exec();
    if (existente)
      throw new BadRequestException(
        'Ya existe un tipo de comprobante con ese código',
      );
    const created = new this.comprobanteTipoModel(createDto);
    return created.save();
  }

  async findAll(): Promise<ComprobanteTipo[]> {
    return this.comprobanteTipoModel.find().sort({ codigo: 1 }).exec();
  }

  async findOne(id: string): Promise<ComprobanteTipo> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Tipo de comprobante no encontrado');
    const doc = await this.comprobanteTipoModel.findById(id).exec();
    if (!doc)
      throw new NotFoundException('Tipo de comprobante no encontrado');
    return doc;
  }

  async update(
    id: string,
    updateDto: UpdateComprobanteTipoDto,
  ): Promise<ComprobanteTipo> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Tipo de comprobante no encontrado');
    if (updateDto.codigo) {
      const existente = await this.comprobanteTipoModel
        .findOne({ codigo: updateDto.codigo, _id: { $ne: id } })
        .exec();
      if (existente)
        throw new BadRequestException(
          'Ya existe un tipo de comprobante con ese código',
        );
    }
    const updated = await this.comprobanteTipoModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .exec();
    if (!updated)
      throw new NotFoundException('Tipo de comprobante no encontrado');
    return updated;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Tipo de comprobante no encontrado');
    const removed = await this.comprobanteTipoModel
      .findByIdAndDelete(id)
      .exec();
    if (!removed)
      throw new NotFoundException('Tipo de comprobante no encontrado');
    return { deleted: true };
  }
}