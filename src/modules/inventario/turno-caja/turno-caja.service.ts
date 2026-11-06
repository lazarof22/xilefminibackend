import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { JwtUser } from '../../auth/types/jwt-user.type';
import { AbrirTurnoCajaDto } from './dto/abrir-turno-caja.dto';
import { CerrarTurnoCajaDto } from './dto/cerrar-turno-caja.dto';
import { ListarTurnosCajaQueryDto } from './dto/listar-turnos-caja-query.dto';
import {
  EstadoTurnoCaja,
  TurnoCaja,
  TurnoCajaPlano,
} from './schema/turno-caja.schema';

type UsuarioTurno = Pick<JwtUser, 'userId' | 'nombre' | 'rol'>;

/** Los códigos de moneda son claves de un mapa de Mongo: sin '.' ni '$'. */
const CODIGO_MONEDA = /^[^.$\s][^.$]*$/;

@Injectable()
export class TurnoCajaService {
  constructor(
    @InjectModel(TurnoCaja.name) private turnoModel: Model<TurnoCaja>,
  ) {}

  /** Abre el turno del cajero autenticado: solo puede haber uno abierto. */
  async abrir(
    usuario: UsuarioTurno,
    dto: AbrirTurnoCajaDto,
  ): Promise<TurnoCajaPlano> {
    const fondoInicial = this.validarFondo(dto.fondoInicial);
    const cajeroId = new Types.ObjectId(usuario.userId);

    const abierto = await this.turnoModel
      .findOne({ cajeroId, estado: EstadoTurnoCaja.ABIERTO })
      .select('_id')
      .lean()
      .exec();
    if (abierto) throw this.yaAbierto();

    try {
      const creado = await this.turnoModel.create({
        cajeroId,
        cajeroNombre: usuario.nombre,
        fechaApertura: new Date(),
        fondoInicial,
        estado: EstadoTurnoCaja.ABIERTO,
      });
      return creado.toObject({ flattenMaps: true });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw this.yaAbierto();
      throw error;
    }
  }

  /** Turno abierto del cajero, o `null` si no tiene ninguno. */
  async abiertoDe(cajeroId: string): Promise<TurnoCajaPlano | null> {
    if (!isValidObjectId(cajeroId)) return null;
    return (await this.turnoModel
      .findOne({
        cajeroId: new Types.ObjectId(cajeroId),
        estado: EstadoTurnoCaja.ABIERTO,
      })
      .lean()
      .exec()) as unknown as TurnoCajaPlano | null;
  }

  async cerrar(
    id: string,
    usuario: UsuarioTurno,
    dto: CerrarTurnoCajaDto,
  ): Promise<TurnoCajaPlano> {
    const turno = await this.buscar(id);
    if (turno.estado !== EstadoTurnoCaja.ABIERTO)
      throw new ConflictException('El turno ya está cerrado');
    if (
      String(turno.cajeroId) !== usuario.userId &&
      usuario.rol !== (UsuarioRol.ADMIN as string)
    )
      throw new ForbiddenException(
        'Solo el cajero del turno o un administrador puede cerrarlo',
      );

    // Atómico: si dos cierres coinciden, solo uno encuentra el turno abierto.
    const cerrado = (await this.turnoModel
      .findOneAndUpdate(
        { _id: id, estado: EstadoTurnoCaja.ABIERTO },
        {
          $set: {
            estado: EstadoTurnoCaja.CERRADO,
            fechaCierre: new Date(),
            ...(dto.observaciones
              ? { observacionesCierre: dto.observaciones }
              : {}),
          },
        },
        { new: true },
      )
      .lean()
      .exec()) as unknown as TurnoCajaPlano | null;
    if (!cerrado) throw new ConflictException('El turno ya está cerrado');
    return cerrado;
  }

  /** Un cajero solo ve sus propios turnos; el resto de roles con acceso, todos. */
  async listar(
    query: ListarTurnosCajaQueryDto,
    usuario?: UsuarioTurno,
  ): Promise<TurnoCajaPlano[]> {
    const filtro: Record<string, unknown> = {};
    if (query.estado) filtro.estado = query.estado;
    if (usuario && this.esCajero(usuario)) {
      if (query.cajeroId && query.cajeroId !== usuario.userId)
        throw new ForbiddenException('Solo puede consultar sus propios turnos');
      filtro.cajeroId = new Types.ObjectId(usuario.userId);
    } else if (query.cajeroId)
      filtro.cajeroId = new Types.ObjectId(query.cajeroId);
    return (await this.turnoModel
      .find(filtro)
      .sort({ fechaApertura: -1 })
      .lean()
      .exec()) as unknown as TurnoCajaPlano[];
  }

  async findOne(id: string, usuario?: UsuarioTurno): Promise<TurnoCajaPlano> {
    const turno = await this.buscar(id);
    if (
      usuario &&
      this.esCajero(usuario) &&
      String(turno.cajeroId) !== usuario.userId
    )
      throw new ForbiddenException('Solo puede consultar sus propios turnos');
    return turno;
  }

  private esCajero(usuario: UsuarioTurno): boolean {
    return usuario.rol === (UsuarioRol.CAJERO as string);
  }

  private async buscar(id: string): Promise<TurnoCajaPlano> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Turno de caja no encontrado');
    const turno = (await this.turnoModel
      .findById(id)
      .lean()
      .exec()) as unknown as TurnoCajaPlano | null;
    if (!turno) throw new NotFoundException('Turno de caja no encontrado');
    return turno;
  }

  private validarFondo(fondo: Record<string, number>): Record<string, number> {
    const entradas = Object.entries(fondo ?? {});
    if (entradas.length === 0)
      throw new BadRequestException(
        'Indique el fondo inicial de al menos una moneda',
      );
    for (const [moneda, monto] of entradas) {
      if (!CODIGO_MONEDA.test(moneda))
        throw new BadRequestException(`Código de moneda inválido: "${moneda}"`);
      if (typeof monto !== 'number' || !Number.isFinite(monto) || monto < 0)
        throw new BadRequestException(
          `El fondo inicial de ${moneda} debe ser un número mayor o igual que cero`,
        );
    }
    return { ...fondo };
  }

  private yaAbierto(): ConflictException {
    return new ConflictException(
      'El cajero ya tiene un turno abierto; ciérrelo antes de abrir otro',
    );
  }
}
