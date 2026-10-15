import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { CreateProveedorDto } from './dto/create-proveedor.dto';
import { UpdateProveedorDto } from './dto/update-proveedor.dto';
import {
  COLLATION_CODIGO,
  Proveedor,
  ProveedorDocument,
} from './schema/proveedor.schema';

const MONGO_DUPLICADO = 11000;

function esDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === MONGO_DUPLICADO
  );
}

@Injectable()
export class ProveedorService {
  constructor(
    @InjectModel(Proveedor.name)
    private readonly proveedorModel: Model<ProveedorDocument>,
  ) {}

  async create(dto: CreateProveedorDto): Promise<ProveedorDocument> {
    await this.asegurarCodigoLibre(dto.codigo);
    try {
      return await this.proveedorModel.create(dto);
    } catch (error) {
      if (esDuplicado(error)) throw this.codigoEnUso(dto.codigo);
      throw error;
    }
  }

  async findAll(): Promise<ProveedorDocument[]> {
    return this.proveedorModel
      .find()
      .collation(COLLATION_CODIGO)
      .sort({ codigo: 1 })
      .exec();
  }

  async findOne(id: string): Promise<ProveedorDocument> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Proveedor no encontrado');
    const doc = await this.proveedorModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Proveedor no encontrado');
    return doc;
  }

  async update(
    id: string,
    dto: UpdateProveedorDto,
  ): Promise<ProveedorDocument> {
    const doc = await this.findOne(id);
    if (dto.codigo !== undefined && dto.codigo !== doc.codigo) {
      await this.asegurarCodigoLibre(dto.codigo, String(doc._id));
    }
    doc.set(dto);
    try {
      return await doc.save();
    } catch (error) {
      if (esDuplicado(error)) throw this.codigoEnUso(dto.codigo ?? doc.codigo);
      throw error;
    }
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Proveedor no encontrado');
    const eliminado = await this.proveedorModel.findByIdAndDelete(id).exec();
    if (!eliminado) throw new NotFoundException('Proveedor no encontrado');
    return { deleted: true };
  }

  // ─── helpers ───────────────────────────────────────────

  private async asegurarCodigoLibre(
    codigo: string,
    exceptoId?: string,
  ): Promise<void> {
    const existente = await this.proveedorModel
      .findOne({ codigo })
      .collation(COLLATION_CODIGO)
      .select('_id')
      .lean()
      .exec();
    if (existente && String(existente._id) !== (exceptoId ?? '')) {
      throw this.codigoEnUso(codigo);
    }
  }

  private codigoEnUso(codigo: string): ConflictException {
    return new ConflictException(
      `Ya existe un proveedor con el código "${codigo}"`,
    );
  }
}
