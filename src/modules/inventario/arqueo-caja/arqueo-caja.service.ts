import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, Types, isValidObjectId } from 'mongoose';
import { TurnoCaja } from '../turno-caja/schema/turno-caja.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import { ReportePlus } from '../reporte_plus/schema/reporte_plus.schema';
import { LineaTurnoArchivada } from '../reporte_plus/schema/linea-turno-archivada.schema';
import { Venta } from '../venta/schema/venta.schema';
import { Pago } from '../pago/schema/pago.schema';
import {
  FilaVenta,
  MovimientoMoneda,
  redondear,
  resolverFlujosFisicos,
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
  private readonly logger = new Logger(ArqueoCajaService.name);

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
    /**
     * Venta and Pago let the expected cash follow the physical currencies of
     * sales made with foreign currency; without them the rows are used as is.
     */
    @Optional() @InjectModel(Venta.name) private ventaModel?: Model<Venta>,
    @Optional() @InjectModel(Pago.name) private pagoModel?: Model<Pago>,
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
    // El arqueo ya existe (índice único por turno): si solo falla el vínculo
    // en el turno se reintenta y, si sigue fallando, no se reporta error
    // porque reintentar la creación daría 409.
    await this.vincularAlTurno(turno._id, plano._id);
    return plano;
  }

  private async vincularAlTurno(
    turnoId: Types.ObjectId,
    arqueoId: Types.ObjectId,
  ): Promise<void> {
    let ultimoError: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        await this.turnoModel.updateOne(
          { _id: turnoId },
          { $set: { arqueo: arqueoId } },
        );
        return;
      } catch (error) {
        ultimoError = error;
      }
    }
    this.logger.error(
      `Arqueo ${String(arqueoId)} creado pero sin vincular al turno ${String(turnoId)}: ${String(ultimoError)}`,
    );
  }

  async listar(turnoCajaId?: string): Promise<ArqueoCajaPlano[]> {
    const filtro: Record<string, unknown> = {};
    if (turnoCajaId) {
      if (!isValidObjectId(turnoCajaId))
        throw new BadRequestException('El ID del turno no es válido');
      filtro.turnoCajaId = new Types.ObjectId(turnoCajaId);
    }
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
    const columnas = 'fecha metodoPago total moneda origen referencia';

    const abiertas = (await this.reporteModel
      .find({ turnoCierre: { $exists: false }, fecha })
      .select(columnas)
      .lean()
      .exec()) as unknown as FilaVenta[];
    const archivadas = (await this.archivadaModel
      .find({ fecha })
      .select(columnas)
      .lean()
      .exec()) as unknown as FilaVenta[];
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
      turno._id,
    );

    // Las ventas con divisas se miden por lo que entró y salió de cada caja
    // física (su pago), no por la fila del reporte, que siempre está en CUP.
    const { filas, flujos } = await resolverFlujosFisicos(
      [...abiertas, ...archivadas],
      this.ventaModel,
      this.pagoModel,
      (error) =>
        this.logger.warn(
          `No se pudieron leer los pagos de las ventas del turno ${String(turno._id)}; se usan las filas del reporte: ${String(error)}`,
        ),
    );

    return resumirPorMoneda({
      fondoInicial: turno.fondoInicial ?? {},
      filas,
      flujosFisicos: flujos,
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
