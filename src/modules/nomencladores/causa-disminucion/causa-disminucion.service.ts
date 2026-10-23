import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { normalizeName } from '../shared/nomenclador-utils';
import { CreateCausaDisminucionDto } from './dto/create-causa-disminucion.dto';
import { UpdateCausaDisminucionDto } from './dto/update-causa-disminucion.dto';
import { CausaDisminucion } from './schema/causa-disminucion.schema';

/** Causas con las que arranca el nomenclador (las que antes estaban fijas en el frontend). */
export const CAUSAS_INICIALES = [
  'Producto dañado',
  'Venta manual',
  'Pérdida',
  'Ajuste administrativo',
];

@Injectable()
export class CausaDisminucionService implements OnModuleInit {
  private readonly logger = new Logger(CausaDisminucionService.name);

  constructor(
    @InjectModel(CausaDisminucion.name)
    private causaModel: Model<CausaDisminucion>,
  ) {}

  /** Si el nomenclador está vacío se cargan las causas iniciales (una sola vez). */
  async onModuleInit(): Promise<void> {
    try {
      if ((await this.causaModel.estimatedDocumentCount()) > 0) return;
      await this.causaModel.insertMany(
        CAUSAS_INICIALES.map((nombre_causa) => ({ nombre_causa })),
        { ordered: false },
      );
    } catch (error) {
      // No impide arrancar el backend: las causas se pueden agregar a mano.
      this.logger.warn(
        `No se pudieron cargar las causas iniciales: ${String(error)}`,
      );
    }
  }

  private nombreValido(valor: string): string {
    const nombre = normalizeName(valor ?? '');
    if (!nombre) {
      throw new BadRequestException('El nombre de la causa es obligatorio');
    }
    return nombre;
  }

  /** Busca ignorando mayúsculas; `excluirId` evita chocar consigo mismo al editar. */
  private buscarPorNombre(nombre: string, excluirId?: string) {
    const escaped = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.causaModel.findOne({
      nombre_causa: { $regex: new RegExp('^' + escaped + '$', 'i') },
      ...(excluirId ? { _id: { $ne: excluirId } } : {}),
    });
  }

  async findOrCreate(nombre: string): Promise<Types.ObjectId> {
    const normalizado = this.nombreValido(nombre);
    const doc =
      (await this.buscarPorNombre(normalizado)) ??
      (await this.causaModel.create({ nombre_causa: normalizado }));
    return doc._id;
  }

  async create(dto: CreateCausaDisminucionDto): Promise<CausaDisminucion> {
    const nombre = this.nombreValido(dto.nombre_causa);
    if (await this.buscarPorNombre(nombre)) {
      throw new BadRequestException('Ya existe la causa de disminución');
    }
    return new this.causaModel({ nombre_causa: nombre }).save();
  }

  findAll(): Promise<CausaDisminucion[]> {
    return this.causaModel
      .find()
      .collation({ locale: 'es', strength: 2 })
      .sort({ nombre_causa: 1 })
      .exec();
  }

  async findOne(id: string): Promise<CausaDisminucion> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('No se encontró la causa de disminución');
    }
    const causa = await this.causaModel.findById(id).exec();
    if (!causa) {
      throw new NotFoundException('No se encontró la causa de disminución');
    }
    return causa;
  }

  async update(
    id: string,
    dto: UpdateCausaDisminucionDto,
  ): Promise<CausaDisminucion> {
    const actual = await this.findOne(id);
    if (dto.nombre_causa === undefined) return actual;

    const nombre = this.nombreValido(dto.nombre_causa);
    if (await this.buscarPorNombre(nombre, id)) {
      throw new BadRequestException('Ya existe la causa de disminución');
    }
    const actualizada = await this.causaModel
      .findByIdAndUpdate(id, { nombre_causa: nombre }, { new: true })
      .exec();
    if (!actualizada) {
      throw new NotFoundException('No se encontró la causa de disminución');
    }
    return actualizada;
  }

  async remove(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('No se encontró la causa de disminución');
    }
    const eliminada = await this.causaModel.findByIdAndDelete(id).exec();
    if (!eliminada) {
      throw new NotFoundException('No se encontró la causa de disminución');
    }
  }
}
