import { ArqueoCajaService } from '../arqueo-caja/arqueo-caja.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { JwtUser } from '../../auth/types/jwt-user.type';
import { CreateDepositoBancarioDto } from './dto/create-deposito-bancario.dto';
import { ListarDepositosQueryDto } from './dto/listar-depositos-query.dto';
import { UpdateConfiguracionDepositoDto } from './dto/update-configuracion-deposito.dto';
import {
  CLAVE_CONFIG_DEPOSITO,
  ConfiguracionDeposito,
  ConfiguracionDepositoPlana,
  MAX_DIAS_ENTRE_DEPOSITOS_POR_DEFECTO,
  PLAZO_DIAS_HABILES_POR_DEFECTO,
} from './schema/configuracion-deposito.schema';
import { DepositoBancario } from './schema/deposito-bancario.schema';
import { diasCorridosEntre, sumarDiasHabiles } from './plazo-deposito.util';

export interface AlertaDeposito {
  tipo: 'turno_sin_deposito' | 'maximo_dias_entre_depositos';
  mensaje: string;
  turnoCajaId?: Types.ObjectId;
  fechaLimite?: Date;
  ultimoDeposito?: Date;
  diasTranscurridos?: number;
  maximo?: number;
}

export interface RespuestaAlertas {
  activas: boolean;
  alertas: AlertaDeposito[];
  plazoDiasHabiles?: number;
  maxDiasEntreDepositos?: number;
}

interface TurnoParaAlerta {
  _id: Types.ObjectId;
  fechaApertura: Date;
  fechaCierre?: Date;
}

type UsuarioDeposito = Pick<JwtUser, 'userId' | 'rol'>;

const esCajero = (u?: UsuarioDeposito): u is UsuarioDeposito =>
  u?.rol === (UsuarioRol.CAJERO as string);

@Injectable()
export class DepositoBancarioService {
  constructor(
    @InjectModel(DepositoBancario.name)
    private depositoModel: Model<DepositoBancario>,
    @InjectModel(ConfiguracionDeposito.name)
    private configModel: Model<ConfiguracionDeposito>,
    @InjectModel(TurnoCaja.name) private turnoModel: Model<TurnoCaja>,
    private readonly arqueoService: ArqueoCajaService,
  ) {}

  /**
   * Un cajero solo deposita el efectivo de SU turno; economico, gerente y
   * administrador registran el de cualquier turno.
   */
  async registrar(
    dto: CreateDepositoBancarioDto,
    usuarioId: string,
    rol?: string,
  ): Promise<DepositoBancario> {
    if (!(dto.monto > 0))
      throw new BadRequestException('El monto debe ser mayor que cero');
    const turno = (await this.turnoModel
      .findById(dto.turnoCajaId)
      .select('_id cajeroId')
      .lean()
      .exec()) as unknown as { _id: Types.ObjectId; cajeroId?: unknown } | null;
    if (!turno) throw new NotFoundException('Turno de caja no encontrado');
    if (
      esCajero({ userId: usuarioId, rol: rol ?? '' }) &&
      String(turno.cajeroId) !== usuarioId
    )
      throw new ForbiddenException(
        'Un cajero solo registra depósitos de su propio turno',
      );

    // No se deposita más efectivo del que el turno tiene en esa moneda. Un depósito sobre un
    // turno ya cerrado es válido (se deposita a más tardar el siguiente día hábil), pero el
    // dinero tiene que seguir en la caja del turno.
    const moneda = dto.moneda?.trim() || 'CUP';
    const { efectivoEsperado } = await this.arqueoService.esperadoDelTurno(
      dto.turnoCajaId,
    );
    const disponible = efectivoEsperado[moneda] ?? 0;
    if (dto.monto > disponible + 0.005)
      throw new BadRequestException(
        `El turno solo tiene ${disponible.toFixed(2)} ${moneda} en efectivo: no se puede depositar ${dto.monto}`,
      );

    const creado = await this.depositoModel.create({
      turnoCajaId: new Types.ObjectId(dto.turnoCajaId),
      monto: dto.monto,
      moneda,
      banco: dto.banco,
      referencia: dto.referencia,
      fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
      registradoPor: new Types.ObjectId(usuarioId),
    });
    return creado.toObject();
  }

  async listar(
    query: ListarDepositosQueryDto,
    usuario?: UsuarioDeposito,
  ): Promise<DepositoBancario[]> {
    const filtro: Record<string, unknown> = {};
    if (query.turnoCajaId)
      filtro.turnoCajaId = new Types.ObjectId(query.turnoCajaId);
    if (esCajero(usuario))
      filtro.registradoPor = new Types.ObjectId(usuario.userId);
    return this.depositoModel.find(filtro).sort({ fecha: -1 }).lean().exec();
  }

  async findOne(
    id: string,
    usuario?: UsuarioDeposito,
  ): Promise<DepositoBancario> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Depósito no encontrado');
    const dep = (await this.depositoModel
      .findById(id)
      .lean()
      .exec()) as unknown as DepositoBancario | null;
    if (!dep) throw new NotFoundException('Depósito no encontrado');
    if (esCajero(usuario) && String(dep.registradoPor) !== usuario.userId)
      throw new ForbiddenException(
        'Solo puede consultar sus propios depósitos',
      );
    return dep;
  }

  async obtenerConfiguracion(): Promise<ConfiguracionDepositoPlana> {
    const c = (await this.configModel
      .findOne({ clave: CLAVE_CONFIG_DEPOSITO })
      .lean()
      .exec()) as unknown as Partial<ConfiguracionDepositoPlana> | null;
    return this.conDefectos(c);
  }

  private conDefectos(
    c: Partial<ConfiguracionDepositoPlana> | null,
  ): ConfiguracionDepositoPlana {
    return {
      alertasActivas: c?.alertasActivas ?? false,
      plazoDiasHabiles: c?.plazoDiasHabiles ?? PLAZO_DIAS_HABILES_POR_DEFECTO,
      maxDiasEntreDepositos:
        c?.maxDiasEntreDepositos ?? MAX_DIAS_ENTRE_DEPOSITOS_POR_DEFECTO,
    };
  }

  async actualizarConfiguracion(
    dto: UpdateConfiguracionDepositoDto,
  ): Promise<ConfiguracionDepositoPlana> {
    const cambios: Partial<ConfiguracionDepositoPlana> = {};
    if (dto.alertasActivas !== undefined)
      cambios.alertasActivas = dto.alertasActivas;
    if (dto.plazoDiasHabiles !== undefined)
      cambios.plazoDiasHabiles = dto.plazoDiasHabiles;
    if (dto.maxDiasEntreDepositos !== undefined)
      cambios.maxDiasEntreDepositos = dto.maxDiasEntreDepositos;

    const guardada = (await this.configModel
      .findOneAndUpdate(
        { clave: CLAVE_CONFIG_DEPOSITO },
        { $set: cambios, $setOnInsert: { clave: CLAVE_CONFIG_DEPOSITO } },
        { upsert: true, new: true },
      )
      .lean()
      .exec()) as unknown as Partial<ConfiguracionDepositoPlana> | null;
    return this.conDefectos(guardada);
  }

  /**
   * Alertas de plazo. Solo se calculan si el flag `alertasActivas` está
   * encendido (apagado por defecto hasta confirmar la norma); apagado
   * responde `{ activas: false, alertas: [] }` sin consultar nada más.
   */
  async alertas(ahora: Date = new Date()): Promise<RespuestaAlertas> {
    const config = await this.obtenerConfiguracion();
    if (!config.alertasActivas) return { activas: false, alertas: [] };

    const turnos = (await this.turnoModel
      .find({ estado: EstadoTurnoCaja.CERRADO })
      .select('_id fechaApertura fechaCierre')
      .lean()
      .exec()) as unknown as TurnoParaAlerta[];
    const depositos = (await this.depositoModel
      .find()
      .select('turnoCajaId fecha')
      .lean()
      .exec()) as unknown as { turnoCajaId: Types.ObjectId; fecha: Date }[];

    const alertas: AlertaDeposito[] = [];

    // 1) Turno cerrado sin depósito pasado el plazo en días hábiles.
    const conDeposito = new Set(depositos.map((x) => String(x.turnoCajaId)));
    for (const t of turnos) {
      if (conDeposito.has(String(t._id))) continue;
      const fechaLimite = sumarDiasHabiles(
        t.fechaCierre ?? t.fechaApertura,
        config.plazoDiasHabiles,
      );
      if (ahora.getTime() > fechaLimite.getTime())
        alertas.push({
          tipo: 'turno_sin_deposito',
          mensaje: `El efectivo del turno cerrado no tiene depósito y venció el plazo de ${config.plazoDiasHabiles} día(s) hábil(es)`,
          turnoCajaId: t._id,
          fechaLimite,
        });
    }

    // 2) Demasiados días desde el último depósito.
    if (depositos.length > 0) {
      const ultimo = new Date(
        Math.max(...depositos.map((x) => new Date(x.fecha).getTime())),
      );
      const dias = diasCorridosEntre(ultimo, ahora);
      if (dias > config.maxDiasEntreDepositos)
        alertas.push({
          tipo: 'maximo_dias_entre_depositos',
          mensaje: `Han pasado ${dias} días desde el último depósito (máximo ${config.maxDiasEntreDepositos})`,
          ultimoDeposito: ultimo,
          diasTranscurridos: dias,
          maximo: config.maxDiasEntreDepositos,
        });
    }

    return {
      activas: true,
      alertas,
      plazoDiasHabiles: config.plazoDiasHabiles,
      maxDiasEntreDepositos: config.maxDiasEntreDepositos,
    };
  }
}
