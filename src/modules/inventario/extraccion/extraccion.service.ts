import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { CreateExtraccionDto } from './dto/create-extraccion.dto';
import { Extraccion, ExtraccionDocument } from './schema/extraccion.schema';
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';
import {
  AutorizadorSupervisorService,
  MENSAJE_EXTRACCION_NO_AUTORIZADA,
  esRolSupervisor,
  type Supervisor,
} from '../../auth/autorizador-supervisor.service';
import type { JwtUser } from '../../auth/types/jwt-user.type';

/** Quien extrae: el usuario de la sesión (`request.user`). */
export type ActorExtraccion = Pick<JwtUser, 'userId' | 'nombre' | 'rol'>;

@Injectable()
export class ExtraccionService {
  constructor(
    @InjectModel(Extraccion.name)
    private extraccionModel: Model<ExtraccionDocument>,
    @InjectModel(TurnoCaja.name) private turnoModel: Model<TurnoCaja>,
    private readonly autorizador: AutorizadorSupervisorService,
  ) {}

  /**
   * Una extracción de caja la autoriza un administrador o gerente: o es quien
   * extrae (sesión propia) o aporta el token de acceso de un supervisor
   * (`dto.tokenAutorizador`). El token solo se verifica; nunca se guarda.
   */
  private async autorizar(
    dto: CreateExtraccionDto,
    actor: ActorExtraccion,
  ): Promise<Supervisor> {
    if (esRolSupervisor(actor.rol)) {
      return { userId: actor.userId, nombre: actor.nombre };
    }
    if (!dto.tokenAutorizador) {
      throw new ForbiddenException(MENSAJE_EXTRACCION_NO_AUTORIZADA);
    }
    return this.autorizador.verificar(dto.tokenAutorizador);
  }

  /**
   * El usuario autenticado (`actor`) vincula la extracción a su turno abierto;
   * sin turno abierto la extracción se guarda igual, con `turnoCaja` sin
   * definir.
   */
  async create(
    dto: CreateExtraccionDto,
    actor: ActorExtraccion,
  ): Promise<Extraccion> {
    if (dto.monto <= 0) {
      throw new BadRequestException('El monto debe ser mayor que cero');
    }
    const supervisor = await this.autorizar(dto, actor);

    const cajeroId = actor.userId;
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
      autorizadoPor: {
        usuarioId: new Types.ObjectId(supervisor.userId),
        nombre: supervisor.nombre,
      },
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
