import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contenedor } from '../contenedor/schema/contenedor.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { Existencia } from '../exitencia/schema/existencia.schema';
import { ExistenciaService } from '../exitencia/existencia.service';
import { ambosTipos, redondear } from '../exitencia/existencia.types';
import { KardexService } from '../kardex/kardex.service';
import { KardexTipo } from '../kardex/schema/kardex.schema';
import { ConsecutivoService } from '../consecutivo/consecutivo.service';
import { CausaDisminucionService } from '../../nomencladores/causa-disminucion/causa-disminucion.service';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import type { JwtUser } from '../../auth/types/jwt-user.type';
import {
  CreateAjusteInventarioDto,
  LineaAjusteDto,
} from './dto/create-ajuste-inventario.dto';
import {
  AjusteInventario,
  LineaAjuste,
} from './schema/ajuste-inventario.schema';

/** Roles que pueden ajustar inventario (doc §6.9). */
export const ROLES_AJUSTE: string[] = [UsuarioRol.ADMIN, UsuarioRol.ECONOMICO];

const normalizar = (texto: string): string =>
  texto.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');

@Injectable()
export class AjusteInventarioService {
  private readonly logger = new Logger(AjusteInventarioService.name);

  constructor(
    @InjectModel(AjusteInventario.name)
    private readonly ajusteModel: Model<AjusteInventario>,
    @InjectModel(Producto.name)
    private readonly productoModel: Model<Producto>,
    @InjectModel(Contenedor.name)
    private readonly contenedorModel: Model<Contenedor>,
    @InjectModel(Existencia.name)
    private readonly existenciaModel: Model<Existencia>,
    private readonly consecutivoService: ConsecutivoService,
    private readonly causaService: CausaDisminucionService,
    private readonly existenciaService: ExistenciaService,
    private readonly kardexService: KardexService,
  ) {}

  /**
   * Registra un ajuste SC-2-16. Se valida TODO antes de mover stock (causa,
   * autorización, firma, saldos); después cada línea se aplica con
   * `KardexService.create` (mismo flujo que el ajuste manual: mueve el stock y
   * escribe el kardex con la referencia del documento). Si una línea falla, las
   * anteriores se compensan con movimientos inversos y el documento no se guarda.
   */
  async crear(
    dto: CreateAjusteInventarioDto,
    usuario: JwtUser,
  ): Promise<AjusteInventario> {
    if (!ROLES_AJUSTE.includes(usuario.rol)) {
      throw new ForbiddenException(
        'Solo el administrador o el económico pueden ajustar el inventario',
      );
    }

    const causa = this.obligatorio(
      dto.causa,
      'La causa del ajuste es obligatoria',
    );
    const autorizadoPor = this.obligatorio(
      dto.autorizadoPor,
      'Debe indicar quién autoriza el ajuste',
    );
    const firmadoPor = this.obligatorio(
      dto.firmadoPor,
      'La firma del ajuste es obligatoria',
    );
    this.validarLineas(dto.lineas);
    if (dto.lineas.some((l) => l.ajuste < 0)) {
      await this.validarCausaDeDisminucion(causa);
    }

    const lineas = await this.calcularLineas(dto.lineas);
    const numeroConsecutivo = await this.consecutivoService.siguiente(
      'ajuste',
      'AJU',
    );

    const aplicadas: LineaAjuste[] = [];
    try {
      for (const linea of lineas) {
        await this.aplicar(linea, numeroConsecutivo, causa, autorizadoPor);
        aplicadas.push(linea);
      }
      return await this.ajusteModel.create({
        numeroConsecutivo,
        causa,
        autorizadoPor,
        lineas,
        firmadoPor,
        registradoPor: usuario.nombre,
      });
    } catch (error) {
      await this.compensar(aplicadas, numeroConsecutivo);
      throw error;
    }
  }

  async findAll(): Promise<AjusteInventario[]> {
    return this.ajusteModel.find().sort({ createdAt: -1 }).lean().exec();
  }

  async findOne(id: string): Promise<AjusteInventario> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('El ID del ajuste no es válido');
    }
    const ajuste = await this.ajusteModel.findById(id).lean().exec();
    if (!ajuste) {
      throw new NotFoundException('No se encontró el ajuste de inventario');
    }
    return ajuste;
  }

  // ── validación ─────────────────────────────────────────────────────

  private obligatorio(valor: unknown, mensaje: string): string {
    if (typeof valor !== 'string' || !valor.trim()) {
      throw new BadRequestException(mensaje);
    }
    return valor.trim();
  }

  private validarLineas(lineas: LineaAjusteDto[]): void {
    if (!Array.isArray(lineas) || lineas.length === 0) {
      throw new BadRequestException('El ajuste necesita al menos una línea');
    }
    for (const linea of lineas) {
      if ('saldoAntes' in linea || 'saldoDespues' in linea) {
        throw new BadRequestException(
          'El saldo antes y después lo calcula el servidor',
        );
      }
      if (!Number.isFinite(linea.ajuste) || linea.ajuste === 0) {
        throw new BadRequestException(
          'El ajuste de cada línea debe ser un número distinto de cero',
        );
      }
    }
  }

  /** Las disminuciones deben usar una causa del nomenclador. */
  private async validarCausaDeDisminucion(causa: string): Promise<void> {
    const causas = await this.causaService.findAll();
    const existe = causas.some(
      (c) => normalizar(c.nombre_causa) === normalizar(causa),
    );
    if (!existe) {
      throw new BadRequestException(
        `La causa "${causa}" no existe en el nomenclador de causas de disminución`,
      );
    }
  }

  /** Lee los saldos del servidor y calcula el saldo después de cada línea. */
  private async calcularLineas(
    lineas: LineaAjusteDto[],
  ): Promise<LineaAjuste[]> {
    const unificado = await this.existenciaService.estaUnificado();
    // Saldo corriente por clave: dos líneas de la misma ubicación se encadenan.
    const corriente = new Map<string, number>();
    const resultado: LineaAjuste[] = [];

    for (const dto of lineas) {
      const [producto, contenedor] = await Promise.all([
        this.productoModel
          .findById(dto.producto)
          .select('stock_inicial')
          .lean()
          .exec(),
        this.contenedorModel
          .findById(dto.contenedor)
          .select('almacen')
          .lean()
          .exec(),
      ]);
      if (!producto) throw new NotFoundException('El producto no existe');
      if (!contenedor) throw new NotFoundException('El contenedor no existe');
      if (String(contenedor.almacen) !== dto.almacen) {
        throw new BadRequestException(
          'El contenedor no pertenece al almacén indicado',
        );
      }

      const clave = unificado
        ? `${dto.producto}|${dto.almacen}|${dto.contenedor}`
        : dto.producto;
      const saldoAntes =
        corriente.get(clave) ??
        (unificado
          ? await this.saldoEnUbicacion(dto)
          : redondear(Number(producto.stock_inicial) || 0));
      const saldoDespues = redondear(saldoAntes + dto.ajuste);
      if (saldoDespues < 0) {
        throw new BadRequestException(
          `El ajuste dejaría el saldo en negativo (saldo ${saldoAntes}, ajuste ${dto.ajuste})`,
        );
      }
      corriente.set(clave, saldoDespues);

      resultado.push({
        producto: new Types.ObjectId(dto.producto),
        almacen: new Types.ObjectId(dto.almacen),
        contenedor: new Types.ObjectId(dto.contenedor),
        saldoAntes,
        ajuste: dto.ajuste,
        saldoDespues,
      });
    }
    return resultado;
  }

  /** Saldo en `Existencia`; los ids pueden estar guardados como ObjectId o como texto. */
  private async saldoEnUbicacion(dto: LineaAjusteDto): Promise<number> {
    const filas = await this.existenciaModel
      .find({
        producto: { $in: ambosTipos(new Types.ObjectId(dto.producto)) },
        almacen: { $in: ambosTipos(new Types.ObjectId(dto.almacen)) },
        contenedor: { $in: ambosTipos(new Types.ObjectId(dto.contenedor)) },
      })
      .select('cantidad')
      .lean()
      .exec();
    return redondear(
      filas.reduce((suma, f) => suma + (Number(f.cantidad) || 0), 0),
    );
  }

  // ── aplicación y compensación ──────────────────────────────────────

  private async aplicar(
    linea: LineaAjuste,
    referencia: string,
    causa: string,
    autorizadoPor: string,
  ): Promise<void> {
    await this.kardexService.create({
      productoId: String(linea.producto),
      tipo: linea.ajuste > 0 ? KardexTipo.ENTRADA : KardexTipo.SALIDA,
      cantidad: Math.abs(linea.ajuste),
      motivo: `Ajuste ${referencia}: ${causa}. Saldo ${linea.saldoAntes} → ${linea.saldoDespues}. Autoriza: ${autorizadoPor}`,
      almacenId: String(linea.almacen),
      contenedorId: String(linea.contenedor),
      referencia,
    });
  }

  /** Revierte las líneas ya aplicadas con el movimiento inverso (queda en el kardex). */
  private async compensar(
    aplicadas: LineaAjuste[],
    referencia: string,
  ): Promise<void> {
    for (const linea of [...aplicadas].reverse()) {
      try {
        await this.kardexService.create({
          productoId: String(linea.producto),
          tipo: linea.ajuste > 0 ? KardexTipo.SALIDA : KardexTipo.ENTRADA,
          cantidad: Math.abs(linea.ajuste),
          motivo: `Reversión de ${referencia}: el ajuste no se completó`,
          almacenId: String(linea.almacen),
          contenedorId: String(linea.contenedor),
          referencia,
        });
      } catch (error) {
        this.logger.error(
          `No se pudo revertir la línea del producto ${String(linea.producto)} del ajuste ${referencia}, corregir a mano: ${String(error)}`,
        );
      }
    }
  }
}
