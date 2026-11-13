import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  esClaveDuplicada,
  insertarIgnorandoDuplicados,
} from '../../../common/utils/insertar-idempotente';
import { BANCOS_INICIALES } from './bancos-iniciales';
import { CreateBancoDto } from './dto/create-banco.dto';
import { UpdateBancoDto } from './dto/update-banco.dto';
import { coincideConAlguno, soloDigitos } from './prefijo-tarjeta';
import { Banco } from './schema/banco.schema';

/** Lo que el cobro necesita de un banco. */
export interface BancoResuelto {
  _id: Types.ObjectId;
  codigo: string;
  nombre: string;
  prefijosTarjeta: string[];
}

@Injectable()
export class BancoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BancoService.name);

  constructor(@InjectModel(Banco.name) private readonly model: Model<Banco>) {}

  /** Al arrancar, llena el nomenclador la primera vez. Un fallo aquí no impide arrancar. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const sembrados = await this.sembrarSiVacio();
      if (sembrados > 0) {
        this.logger.log(
          `Nomenclador de bancos creado con ${sembrados} bancos (sin prefijos de tarjeta)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `No se pudieron crear los bancos iniciales: ${String(error)}`,
      );
    }
  }

  /** Crea los bancos por defecto solo si la colección está vacía. Devuelve cuántos creó. */
  async sembrarSiVacio(): Promise<number> {
    if (await this.model.exists({})) return 0;

    await insertarIgnorandoDuplicados(
      this.model,
      BANCOS_INICIALES.map((b) => ({
        ...b,
        prefijosTarjeta: [],
        activo: true,
      })),
    );

    return BANCOS_INICIALES.length;
  }

  async findAll(soloActivos = false): Promise<Banco[]> {
    const filas = await this.model
      .find(soloActivos ? { activo: true } : {})
      .lean()
      .exec();

    return filas.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async findOne(id: string): Promise<Banco> {
    const fila = await this.model.findById(this.validarId(id)).lean().exec();

    if (!fila) throw new NotFoundException('No se encontró el banco');

    return fila;
  }

  async create(dto: CreateBancoDto): Promise<Banco> {
    try {
      return await this.model.create({
        codigo: dto.codigo,
        nombre: dto.nombre,
        prefijosTarjeta: dto.prefijosTarjeta ?? [],
        activo: dto.activo ?? true,
      });
    } catch (error) {
      throw this.traducirDuplicado(error, dto.codigo);
    }
  }

  async update(id: string, dto: UpdateBancoDto): Promise<Banco> {
    try {
      const fila = await this.model
        .findByIdAndUpdate(this.validarId(id), dto, {
          returnDocument: 'after',
          runValidators: true,
        })
        .lean()
        .exec();

      if (!fila) throw new NotFoundException('No se encontró el banco');

      return fila;
    } catch (error) {
      throw this.traducirDuplicado(error, dto.codigo);
    }
  }

  async remove(id: string): Promise<void> {
    const fila = await this.model
      .findByIdAndDelete(this.validarId(id))
      .lean()
      .exec();

    if (!fila) throw new NotFoundException('No se encontró el banco');
  }

  /**
   * Banco de una transferencia. Con `bancoId` el banco debe existir y estar
   * activo (si no, se rechaza). Con `codigo` (texto libre, como mandaba el
   * diálogo anterior) se busca por código sin exigir que exista: devuelve
   * `undefined` y el pago queda con el texto tal cual, sin validar tarjeta.
   */
  async resolver(entrada: {
    bancoId?: string;
    codigo?: string;
  }): Promise<BancoResuelto | undefined> {
    if (entrada.bancoId) {
      const fila = await this.model
        .findById(this.validarId(entrada.bancoId))
        .lean()
        .exec();

      if (!fila || !fila.activo) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          message: 'El banco seleccionado no existe o está desactivado',
          codigo: 'BANCO_NO_VALIDO',
        });
      }

      return this.aResuelto(fila);
    }

    const codigo = entrada.codigo?.trim().toUpperCase();
    if (!codigo) return undefined;

    const fila = await this.model
      .findOne({ codigo, activo: true })
      .lean()
      .exec();

    return fila ? this.aResuelto(fila) : undefined;
  }

  /**
   * Aviso (nunca bloqueo) si el número de tarjeta no parece de ese banco.
   * Sin prefijos configurados para el banco no hay nada contra qué validar.
   */
  async advertenciaDeTarjeta(
    banco: BancoResuelto,
    numeroTarjeta: string,
  ): Promise<string | undefined> {
    if (banco.prefijosTarjeta.length === 0) return undefined;

    const digitos = soloDigitos(numeroTarjeta);
    if (coincideConAlguno(digitos, banco.prefijosTarjeta)) return undefined;

    const otros = await this.model
      .find({ activo: true, _id: { $ne: banco._id } })
      .lean()
      .exec();
    const parecido = otros.find((o) =>
      coincideConAlguno(digitos, o.prefijosTarjeta ?? []),
    );

    return parecido
      ? `El número de tarjeta parece de ${parecido.nombre} (${parecido.codigo}), no de ${banco.nombre} (${banco.codigo}). Revíselo; no bloquea el cobro.`
      : `El número de tarjeta no empieza con ninguno de los prefijos configurados para ${banco.nombre} (${banco.codigo}). Revíselo; no bloquea el cobro.`;
  }

  private aResuelto(fila: Banco & { _id: Types.ObjectId }): BancoResuelto {
    return {
      _id: fila._id,
      codigo: fila.codigo,
      nombre: fila.nombre,
      prefijosTarjeta: fila.prefijosTarjeta ?? [],
    };
  }

  private validarId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('El identificador no es válido');
    }

    return new Types.ObjectId(id);
  }

  private traducirDuplicado(error: unknown, codigo?: string): unknown {
    if (esClaveDuplicada(error)) {
      return new ConflictException(
        codigo
          ? `Ya existe un banco con el código ${codigo}`
          : 'Ya existe un banco con ese código',
      );
    }

    return error;
  }
}
