import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, Types, isValidObjectId } from 'mongoose';
import { TurnoCaja } from '../turno-caja/schema/turno-caja.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import { ReportePlus } from '../reporte_plus/schema/reporte_plus.schema';
import { LineaTurnoArchivada } from '../reporte_plus/schema/linea-turno-archivada.schema';
import {
  FilaMoneda,
  MovimientoMoneda,
  redondear,
  resumirPorMoneda,
  ResumenMonedas,
} from '../reporte_plus/efectivo-turno.util';
import { Devolucion } from '../devolucion/schema/devolucion.schema';
import { devolucionesEfectivoEnVentana } from '../devolucion/devolucion-efectivo.util';
import { CreateArqueoCajaDto } from './dto/create-arqueo-caja.dto';
import {
  ArqueoCaja,
  ArqueoCajaPlano,
  DiferenciaArqueoMoneda,
  EfectivoArqueoMoneda,
} from './schema/arqueo-caja.schema';

interface TurnoLeido {
  _id: Types.ObjectId;
  cajeroNombre?: string;
  fechaApertura: Date;
  fechaCierre?: Date;
  fondoInicial: Record<string, number>;
}

const normalizar = (s?: string): string =>
  (s ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

@Injectable()
export class ArqueoCajaService {
  constructor(
    @InjectModel(ArqueoCaja.name) private arqueoModel: Model<ArqueoCaja>,
    @InjectModel(TurnoCaja.name) private turnoModel: Model<TurnoCaja>,
    @InjectModel(ReportePlus.name) private reporteModel: Model<ReportePlus>,
    @InjectModel(LineaTurnoArchivada.name)
    private archivadaModel: Model<LineaTurnoArchivada>,
    @InjectModel(Extraccion.name) private extraccionModel: Model<Extraccion>,
    @InjectModel(DepositoBancario.name)
    private depositoModel: Model<DepositoBancario>,
    @InjectModel(Devolucion.name)
    private devolucionModel: Model<Devolucion>,
  ) {}

  /** Efectivo esperado por moneda de un turno (para precargar el arqueo). */
  async esperadoDelTurno(turnoId: string): Promise<ResumenMonedas> {
    return this.calcularEsperado(await this.buscarTurno(turnoId));
  }

  async crear(
    dto: CreateArqueoCajaDto,
    usuarioId: string,
  ): Promise<ArqueoCajaPlano> {
    const turno = await this.buscarTurno(dto.turnoCajaId);

    const previo = await this.arqueoModel
      .findOne({ turnoCajaId: turno._id })
      .select('_id')
      .lean()
      .exec();
    if (previo) throw this.yaTieneArqueo();

    const esperado = (await this.calcularEsperado(turno)).efectivoEsperado;
    const contados = this.validarContados(dto.efectivoContado);
    for (const [moneda, monto] of Object.entries(esperado)) {
      if (monto !== 0 && !(moneda in contados))
        throw new BadRequestException(
          `Falta el efectivo contado de la moneda ${moneda}`,
        );
    }

    // Por moneda: nunca se suman monedas distintas.
    const efectivoContado: Record<string, EfectivoArqueoMoneda> = {};
    const diferencia: Record<string, DiferenciaArqueoMoneda> = {};
    for (const moneda of new Set([
      ...Object.keys(esperado),
      ...Object.keys(contados),
    ])) {
      const esp = esperado[moneda] ?? 0;
      const cont = contados[moneda]?.contado ?? 0;
      efectivoContado[moneda] = {
        esperado: esp,
        contado: cont,
        ...(contados[moneda]?.denominaciones
          ? { denominaciones: contados[moneda].denominaciones }
          : {}),
      };
      const monto = redondear(cont - esp);
      diferencia[moneda] = {
        monto,
        estado:
          Math.abs(monto) < 0.01
            ? 'cuadrado'
            : monto > 0
              ? 'sobrante'
              : 'faltante',
      };
    }

    let creado: HydratedDocument<ArqueoCaja>;
    try {
      creado = await this.arqueoModel.create({
        turnoCajaId: turno._id,
        responsableArqueo: dto.responsableArqueo,
        responsableCustodia: dto.responsableCustodia,
        efectivoContado,
        diferencia,
        mismoResponsableQueCajero:
          normalizar(dto.responsableArqueo) === normalizar(turno.cajeroNombre),
        observaciones: dto.observaciones,
        firmadoPor: dto.firmadoPor,
        creadoPor: new Types.ObjectId(usuarioId),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw this.yaTieneArqueo();
      throw error;
    }
    const plano = creado.toObject({
      flattenMaps: true,
    }) as unknown as ArqueoCajaPlano;
    await this.turnoModel.updateOne(
      { _id: turno._id },
      { $set: { arqueo: plano._id } },
    );
    return plano;
  }

  async listar(turnoCajaId?: string): Promise<ArqueoCajaPlano[]> {
    const filtro: Record<string, unknown> = {};
    if (turnoCajaId) filtro.turnoCajaId = new Types.ObjectId(turnoCajaId);
    return (await this.arqueoModel
      .find(filtro)
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as unknown as ArqueoCajaPlano[];
  }

  async findOne(id: string): Promise<ArqueoCajaPlano> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Arqueo de caja no encontrado');
    const arqueo = (await this.arqueoModel
      .findById(id)
      .lean()
      .exec()) as unknown as ArqueoCajaPlano | null;
    if (!arqueo) throw new NotFoundException('Arqueo de caja no encontrado');
    return arqueo;
  }

  /**
   * Esperado del turno = fondo inicial + entradas − salidas físicas, por
   * moneda. Las ventas se toman por fecha dentro de la ventana del turno (el
   * Reporte Plus no guarda el cajero): filas abiertas + líneas archivadas.
   */
  private async calcularEsperado(turno: TurnoLeido): Promise<ResumenMonedas> {
    const fecha = {
      $gte: turno.fechaApertura,
      $lte: turno.fechaCierre ?? new Date(),
    };
    const columnas = 'fecha metodoPago total moneda';

    const abiertas = (await this.reporteModel
      .find({ turnoCierre: { $exists: false }, fecha })
      .select(columnas)
      .lean()
      .exec()) as unknown as FilaMoneda[];
    const archivadas = (await this.archivadaModel
      .find({ fecha })
      .select(columnas)
      .lean()
      .exec()) as unknown as FilaMoneda[];
    const extracciones = (await this.extraccionModel
      .find({ turnoCaja: turno._id })
      .select('monto moneda')
      .lean()
      .exec()) as unknown as MovimientoMoneda[];
    const depositos = (await this.depositoModel
      .find({ turnoCajaId: turno._id })
      .select('monto moneda')
      .lean()
      .exec()) as unknown as MovimientoMoneda[];

    const devolucionesEfectivo = await devolucionesEfectivoEnVentana(
      this.devolucionModel,
      turno.fechaApertura,
      turno.fechaCierre ?? new Date(),
    );

    return resumirPorMoneda({
      fondoInicial: turno.fondoInicial ?? {},
      filas: [...abiertas, ...archivadas],
      extracciones,
      depositos,
      devolucionesEfectivo,
    });
  }

  private async buscarTurno(id: string): Promise<TurnoLeido> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Turno de caja no encontrado');
    const turno = (await this.turnoModel
      .findById(id)
      .lean()
      .exec()) as unknown as TurnoLeido | null;
    if (!turno) throw new NotFoundException('Turno de caja no encontrado');
    return turno;
  }

  private validarContados(
    contados: CreateArqueoCajaDto['efectivoContado'],
  ): CreateArqueoCajaDto['efectivoContado'] {
    const r: CreateArqueoCajaDto['efectivoContado'] = {};
    for (const [moneda, v] of Object.entries(contados ?? {})) {
      const contado = v?.contado;
      if (
        typeof contado !== 'number' ||
        !Number.isFinite(contado) ||
        contado < 0
      )
        throw new BadRequestException(
          `El efectivo contado de ${moneda} debe ser un número mayor o igual que cero`,
        );
      r[moneda] = {
        contado: redondear(contado),
        denominaciones: v.denominaciones,
      };
    }
    return r;
  }

  private yaTieneArqueo(): ConflictException {
    return new ConflictException('El turno ya tiene un arqueo registrado');
  }
}
