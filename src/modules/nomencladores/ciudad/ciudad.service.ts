import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ciudad } from './schema/ciudad.schema';
import { Pais } from '../pais/schema/pais.schema';
import { CreateCiudadDto } from './dto/create-ciudad.dto';
import { UpdateCiudadDto } from './dto/update-ciudad.dto';
import { normalizeName } from '../shared/nomenclador-utils';

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class CiudadService {
  constructor(
    @InjectModel(Ciudad.name) private readonly ciudadModel: Model<Ciudad>,
    @InjectModel(Pais.name) private readonly paisModel: Model<Pais>,
  ) {}

  private async validarPais(paisId: string): Promise<void> {
    if (!Types.ObjectId.isValid(paisId)) {
      throw new BadRequestException('El país seleccionado no es válido');
    }
    const existe = await this.paisModel.exists({ _id: paisId });
    if (!existe) {
      throw new NotFoundException('No se encontró el país');
    }
  }

  private async validarDuplicado(
    nombreCiudad: string,
    paisId: string,
    excluirId?: string,
  ): Promise<void> {
    const filtro: Record<string, unknown> = {
      pais: new Types.ObjectId(paisId),
      nombreCiudad: {
        $regex: new RegExp('^' + escapeRegex(nombreCiudad) + '$', 'i'),
      },
    };
    if (excluirId) filtro._id = { $ne: excluirId };
    if (await this.ciudadModel.exists(filtro)) {
      throw new BadRequestException(
        'Ya existe esa ciudad en el país seleccionado',
      );
    }
  }

  async create(dto: CreateCiudadDto): Promise<Ciudad> {
    const nombreCiudad = normalizeName(dto.nombreCiudad);
    await this.validarPais(dto.pais);
    await this.validarDuplicado(nombreCiudad, dto.pais);
    const creada = await this.ciudadModel.create({
      nombreCiudad,
      pais: new Types.ObjectId(dto.pais),
    });
    return creada.populate('pais');
  }

  async findAll(paisId?: string): Promise<Ciudad[]> {
    const filtro: Record<string, unknown> = {};
    if (paisId) {
      if (!Types.ObjectId.isValid(paisId)) {
        throw new BadRequestException('El país seleccionado no es válido');
      }
      filtro.pais = new Types.ObjectId(paisId);
    }
    return this.ciudadModel
      .find(filtro)
      .populate('pais')
      .sort({ nombreCiudad: 1 })
      .exec();
  }

  async findOne(id: string): Promise<Ciudad> {
    const ciudad = await this.ciudadModel.findById(id).populate('pais').exec();
    if (!ciudad) {
      throw new NotFoundException('No se encontró la ciudad');
    }
    return ciudad;
  }

  async update(id: string, dto: UpdateCiudadDto): Promise<Ciudad> {
    const actual = await this.ciudadModel.findById(id).exec();
    if (!actual) {
      throw new NotFoundException('No se encontró la ciudad');
    }
    const paisId = dto.pais ?? actual.pais.toString();
    const nombreCiudad = dto.nombreCiudad
      ? normalizeName(dto.nombreCiudad)
      : actual.nombreCiudad;
    if (dto.pais) await this.validarPais(dto.pais);
    await this.validarDuplicado(nombreCiudad, paisId, id);

    actual.nombreCiudad = nombreCiudad;
    actual.pais = new Types.ObjectId(paisId);
    await actual.save();
    return actual.populate('pais');
  }

  async remove(id: string): Promise<void> {
    const eliminada = await this.ciudadModel.findByIdAndDelete(id);
    if (!eliminada) {
      throw new NotFoundException('No se encontró la ciudad');
    }
  }

  async contarPorPais(paisId: string): Promise<number> {
    return this.ciudadModel
      .countDocuments({ pais: new Types.ObjectId(paisId) })
      .exec();
  }
}
