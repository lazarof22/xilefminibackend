import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { CreateElementoGastoDto } from './dto/create-elemento-gasto.dto';
import { UpdateElementoGastoDto } from './dto/update-elemento-gasto.dto';
import {
  ElementoGasto,
  ElementoGastoDocument,
} from './schema/elemento-gasto.schema';

@Injectable()
export class ElementoGastoService {
  constructor(
    @InjectModel(ElementoGasto.name)
    private elementoModel: Model<ElementoGastoDocument>,
  ) {}

  async findOrCreate(codigo: string): Promise<Types.ObjectId> {
    const normalized = codigo.trim().toUpperCase();
    let doc = await this.elementoModel.findOne({ codigo: normalized }).exec();
    if (!doc) {
      doc = await this.elementoModel.create({
        codigo: normalized,
        nombre: normalized,
      });
    }
    return doc._id as Types.ObjectId;
  }

  private async resolverNivel(
    padre?: string,
    nivelEnviado?: number,
  ): Promise<number> {
    if (nivelEnviado !== undefined && nivelEnviado !== null) return nivelEnviado;
    if (!padre) return 1;
    if (!isValidObjectId(padre))
      throw new BadRequestException('ID de padre inválido');
    const doc = await this.elementoModel.findById(padre).exec();
    if (!doc)
      throw new BadRequestException(
        'El elemento de gasto padre indicado no existe',
      );
    return (doc.nivel ?? 1) + 1;
  }

  async create(createDto: CreateElementoGastoDto): Promise<ElementoGasto> {
    const existente = await this.elementoModel
      .findOne({ codigo: createDto.codigo })
      .exec();
    if (existente)
      throw new BadRequestException(
        'Ya existe un elemento de gasto con ese código',
      );

    const nivel = await this.resolverNivel(createDto.padre, createDto.nivel);

    const created = new this.elementoModel({
      ...createDto,
      padre: createDto.padre ? new Types.ObjectId(createDto.padre) : null,
      nivel,
    });
    return created.save();
  }

  async findAll(): Promise<ElementoGasto[]> {
    return this.elementoModel.find().sort({ codigo: 1 }).exec();
  }

  async findOne(id: string): Promise<ElementoGasto> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Elemento de gasto no encontrado');
    const doc = await this.elementoModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Elemento de gasto no encontrado');
    return doc;
  }

  async update(
    id: string,
    updateDto: UpdateElementoGastoDto,
  ): Promise<ElementoGasto> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Elemento de gasto no encontrado');

    if (updateDto.padre === id) {
      throw new BadRequestException(
        'Un elemento de gasto no puede ser padre de sí mismo',
      );
    }

    if (updateDto.codigo) {
      const existente = await this.elementoModel
        .findOne({ codigo: updateDto.codigo, _id: { $ne: id } })
        .exec();
      if (existente)
        throw new BadRequestException(
          'Ya existe un elemento de gasto con ese código',
        );
    }

    const datos: Record<string, unknown> = { ...updateDto };
    if (updateDto.padre !== undefined) {
      datos.padre = updateDto.padre
        ? new Types.ObjectId(updateDto.padre)
        : null;
    }
    if (updateDto.padre !== undefined || updateDto.nivel !== undefined) {
      datos.nivel = await this.resolverNivel(
        updateDto.padre,
        updateDto.nivel,
      );
    }

    const updated = await this.elementoModel
      .findByIdAndUpdate(id, datos, { new: true })
      .exec();
    if (!updated)
      throw new NotFoundException('Elemento de gasto no encontrado');
    return updated;
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Elemento de gasto no encontrado');
    const removed = await this.elementoModel.findByIdAndDelete(id).exec();
    if (!removed)
      throw new NotFoundException('Elemento de gasto no encontrado');
    return { deleted: true };
  }
}
