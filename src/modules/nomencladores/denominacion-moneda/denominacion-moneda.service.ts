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
import { DENOMINACIONES_INICIALES } from './denominaciones-iniciales';
import { CreateDenominacionMonedaDto } from './dto/create-denominacion-moneda.dto';
import { UpdateDenominacionMonedaDto } from './dto/update-denominacion-moneda.dto';
import { DenominacionMoneda } from './schema/denominacion-moneda.schema';

const porMonedaYValor = (
  a: { moneda: string; valor: number },
  b: { moneda: string; valor: number },
): number =>
  a.moneda === b.moneda ? b.valor - a.valor : a.moneda < b.moneda ? -1 : 1;

@Injectable()
export class DenominacionMonedaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DenominacionMonedaService.name);

  constructor(
    @InjectModel(DenominacionMoneda.name)
    private readonly model: Model<DenominacionMoneda>,
  ) {}

  /** Al arrancar, llena el nomenclador la primera vez. Un fallo aquí no impide arrancar. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const sembradas = await this.sembrarSiVacia();
      if (sembradas > 0) {
        this.logger.log(
          `Nomenclador de denominaciones creado con ${sembradas} billetes y monedas (CUP, USD, EUR)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `No se pudieron crear las denominaciones iniciales: ${String(error)}`,
      );
    }
  }

  /** Crea las denominaciones por defecto solo si la colección está vacía. Devuelve cuántas creó. */
  async sembrarSiVacia(): Promise<number> {
    if (await this.model.exists({})) return 0;

    await insertarIgnorandoDuplicados(
      this.model,
      DENOMINACIONES_INICIALES.map((d) => ({ ...d, activa: true })),
    );

    return DENOMINACIONES_INICIALES.length;
  }

  /**
   * Valores de los billetes y monedas activos de una moneda, del mayor al
   * menor. Vacío si la moneda no tiene denominaciones configuradas.
   */
  async listarActivas(moneda: string): Promise<number[]> {
    const filas = await this.model
      .find({ moneda: moneda.trim().toUpperCase(), activa: true })
      .lean()
      .exec();

    return filas.map((f) => f.valor).sort((a, b) => b - a);
  }

  /** Todas las denominaciones activas agrupadas por moneda (una sola consulta). */
  async listarActivasPorMoneda(): Promise<Map<string, number[]>> {
    const filas = await this.model.find({ activa: true }).lean().exec();
    const porMoneda = new Map<string, number[]>();

    for (const fila of filas) {
      porMoneda.set(fila.moneda, [
        ...(porMoneda.get(fila.moneda) ?? []),
        fila.valor,
      ]);
    }

    for (const valores of porMoneda.values()) valores.sort((a, b) => b - a);

    return porMoneda;
  }

  async findAll(moneda?: string): Promise<DenominacionMoneda[]> {
    const filtro = moneda ? { moneda: moneda.trim().toUpperCase() } : {};
    const filas = await this.model.find(filtro).lean().exec();

    return filas.sort(porMonedaYValor);
  }

  async findOne(id: string): Promise<DenominacionMoneda> {
    const fila = await this.model.findById(this.validarId(id)).lean().exec();

    if (!fila) throw new NotFoundException('No se encontró la denominación');

    return fila;
  }

  async create(dto: CreateDenominacionMonedaDto): Promise<DenominacionMoneda> {
    try {
      return await this.model.create({
        moneda: dto.moneda,
        valor: dto.valor,
        tipo: dto.tipo ?? 'billete',
        activa: dto.activa ?? true,
      });
    } catch (error) {
      throw this.traducirDuplicado(error, dto.moneda, dto.valor);
    }
  }

  async update(
    id: string,
    dto: UpdateDenominacionMonedaDto,
  ): Promise<DenominacionMoneda> {
    try {
      const fila = await this.model
        .findByIdAndUpdate(this.validarId(id), dto, {
          returnDocument: 'after',
          runValidators: true,
        })
        .lean()
        .exec();

      if (!fila) throw new NotFoundException('No se encontró la denominación');

      return fila;
    } catch (error) {
      throw this.traducirDuplicado(error, dto.moneda, dto.valor);
    }
  }

  async remove(id: string): Promise<void> {
    const fila = await this.model
      .findByIdAndDelete(this.validarId(id))
      .lean()
      .exec();

    if (!fila) throw new NotFoundException('No se encontró la denominación');
  }

  private validarId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('El identificador no es válido');
    }

    return new Types.ObjectId(id);
  }

  private traducirDuplicado(
    error: unknown,
    moneda?: string,
    valor?: number,
  ): unknown {
    if (esClaveDuplicada(error)) {
      return new ConflictException(
        moneda !== undefined && valor !== undefined
          ? `Ya existe la denominación ${valor} de ${moneda}`
          : 'Ya existe esa denominación para la moneda',
      );
    }

    return error;
  }
}
