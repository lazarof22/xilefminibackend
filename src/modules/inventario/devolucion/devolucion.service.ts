import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';
import { costoVigente, valuarMovimiento } from '../kardex/costo-promedio.util';
import { ultimoCostoPromedio } from '../kardex/costo-promedio.consulta';
import { ubicacionFisicaDe } from '../kardex/ubicacion-fisica.util';
import { Almacen } from '../almacen/schema/almacen.schema';
import { Contenedor } from '../contenedor/schema/contenedor.schema';
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';
import { Producto } from '../producto/schemas/producto.schema';
import { ConsecutivoService } from '../consecutivo/consecutivo.service';
import { ExistenciaService } from '../exitencia/existencia.service';
import {
  EPSILON,
  ResultadoMovimiento,
  TOLERANCIA_SALDO,
  UbicacionCantidad,
  redondear,
} from '../exitencia/existencia.types';
import type { JwtUser } from '../../auth/types/jwt-user.type';
import {
  DevolucionOrigenService,
  OrigenResuelto,
  redondear2,
} from './devolucion-origen.service';
import { repartirEnUbicaciones } from './devolucion-ubicaciones';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import {
  DEVOLUCION_LIMITE_DEFECTO,
  ListarDevolucionesQueryDto,
} from './dto/listar-devoluciones-query.dto';
import {
  Devolucion,
  DevolucionTipo,
  EstadoDevolucion,
  LineaDevolucion,
} from './schema/devolucion.schema';
import { DevolucionAcumulado } from './schema/devolucion-acumulado.schema';

/** Prefijo y clave del consecutivo compartido (`ConsecutivoService`). */
const CLAVE_CONSECUTIVO = 'devolucion';
const PREFIJO_CONSECUTIVO = 'DEV';

/** Un vale en `aplicando` más tiempo que esto se considera interrumpido. */
const ANTIGUEDAD_APLICANDO_MS = 10 * 60 * 1000;

/** Error E11000 de MongoDB (violación del índice único). */
const esClaveDuplicada = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === 11000;

/** Vale persistido, tal como lo devuelven las lecturas `lean`. */
export type DevolucionPersistida = Devolucion & { _id: Types.ObjectId };

/** Cantidad de un producto ya reservada en el acumulado del origen. */
interface Reserva {
  productoId: string;
  cantidad: number;
  /** Cantidad ya devuelta de ese producto ANTES de esta reserva. */
  previo: number;
}

/** Lo que dejó el movimiento de stock de una línea. */
interface StockMovido {
  /** Total del producto después del movimiento. */
  stock: number;
  /** Ubicaciones tocadas (vacío antes de unificar las existencias). */
  ubicaciones: UbicacionCantidad[];
}

/** Movimiento de stock ya aplicado, con lo necesario para deshacerlo. */
interface MovimientoAplicado {
  productoId: string;
  sentido: 'entra' | 'sale';
  /** Modo unificado: ubicaciones tocadas. */
  ubicaciones: UbicacionCantidad[];
  /** Modo antiguo (`Producto.stock_inicial`): cantidad movida. */
  cantidadLegacy?: number;
}

@Injectable()
export class DevolucionService {
  private readonly logger = new Logger(DevolucionService.name);

  constructor(
    @InjectModel(Devolucion.name)
    private readonly devolucionModel: Model<Devolucion>,
    @InjectModel(DevolucionAcumulado.name)
    private readonly acumuladoModel: Model<DevolucionAcumulado>,
    @InjectModel(Kardex.name) private readonly kardexModel: Model<Kardex>,
    @InjectModel(Producto.name) private readonly productoModel: Model<Producto>,
    private readonly consecutivo: ConsecutivoService,
    private readonly existenciaService: ExistenciaService,
    private readonly origenService: DevolucionOrigenService,
    @InjectModel(Almacen.name) private readonly almacenModel: Model<Almacen>,
    @InjectModel(Contenedor.name)
    private readonly contenedorModel: Model<Contenedor>,
    @InjectModel(TurnoCaja.name)
    private readonly turnoModel: Model<TurnoCaja>,
  ) {}

  /** Turno de caja abierto de quien registra (solo lectura), si tiene uno. */
  private async turnoAbiertoDe(
    userId: string,
  ): Promise<Types.ObjectId | undefined> {
    if (!Types.ObjectId.isValid(userId)) return undefined;
    const turno = await this.turnoModel
      .findOne({
        cajeroId: new Types.ObjectId(userId),
        estado: EstadoTurnoCaja.ABIERTO,
      })
      .select('_id')
      .lean()
      .exec();
    return turno?._id;
  }

  // ─── Registrar ───────────────────────────────────────────────────

  /**
   * Emite el Vale SC-2-08 y lo aplica. El orden importa:
   *  1. valida el origen y las líneas (sin escribir nada);
   *  2. reserva el cupo en el acumulado del origen (escritura atómica
   *     condicional: nunca se devuelve más de lo vendido);
   *  3. crea el documento `pendiente`; si no se puede, libera el cupo;
   *  4. `aplicar` mueve stock y Kardex exactamente una vez.
   */
  async registrar(
    dto: CreateDevolucionDto,
    usuario: Pick<JwtUser, 'userId' | 'nombre'>,
  ): Promise<DevolucionPersistida> {
    const origen = await this.origenService.resolver(
      dto.tipo,
      dto.origenTipo,
      dto.origenRef,
    );
    this.validarForma(dto, origen);
    const lineas = this.prepararLineas(dto, origen);
    // Antes de reservar cupo: si esta lectura falla no queda nada que liberar.
    const turnoCaja = await this.turnoAbiertoDe(usuario.userId);

    const reservas = await this.reservar(origen, lineas);

    let creada: { _id: Types.ObjectId };
    // Set as soon as the vale is persisted: the failure path needs to know
    // whether the vale (and not just the reserved cupo) exists.
    let valeId: Types.ObjectId | undefined;
    try {
      const numeroConsecutivo = await this.consecutivo.siguiente(
        CLAVE_CONSECUTIVO,
        PREFIJO_CONSECUTIVO,
      );
      // Cada línea sabe a qué ubicaciones va: `aplicar` no depende del origen.
      const conUbicaciones = lineas.map((l) => {
        const previo =
          reservas.find((r) => r.productoId === l.productoHex)?.previo ?? 0;
        const reparto = repartirEnUbicaciones(
          origen.productos.get(l.productoHex)?.ubicaciones ?? [],
          previo,
          l.cantidadEntregada,
        );
        return {
          producto: new Types.ObjectId(l.productoHex),
          cantidadSolicitada: l.cantidadSolicitada,
          cantidadEntregada: l.cantidadEntregada,
          precioUnitario: l.precioUnitario,
          importe: l.importe,
          ubicaciones: reparto.ubicaciones,
          sinUbicacion: reparto.resto,
        };
      });

      creada = await this.devolucionModel.create({
        numeroConsecutivo,
        tipo: dto.tipo,
        origenTipo: dto.origenTipo,
        origenRef: origen.origenId,
        motivo: dto.motivo.trim(),
        cliente: origen.clienteId,
        lineas: conUbicaciones,
        autorizadoPor: dto.autorizadoPor.trim(),
        recibidoPor: dto.recibidoPor.trim(),
        firma: dto.firma,
        formaDevolucionDinero: origen.formaDinero,
        montoDevuelto: redondear2(
          conUbicaciones.reduce((suma, l) => suma + l.importe, 0),
        ),
        moneda: origen.moneda,
        estado: EstadoDevolucion.PENDIENTE,
        fecha: new Date(),
        registradoPor: { userId: usuario.userId, nombre: usuario.nombre },
        ...(turnoCaja ? { turnoCaja } : {}),
      });
      valeId = creada._id;
      if (!(await this.origenService.sigueVigente(origen))) {
        throw new ConflictException(
          'La factura de origen se está cancelando o ya no está confirmada; no se registró la devolución',
        );
      }
    } catch (error) {
      await this.abortarRegistro(origen, reservas, valeId, error);
      throw error;
    }

    return this.aplicar(String(creada._id));
  }

  /**
   * Failure path of `registrar` before `aplicar` ran. If the vale was never
   * created only the reserved cupo exists, so it is released directly. If the
   * vale exists it is the vale that owns the cupo: it is marked `fallida`
   * with a conditional update from `pendiente` and only the caller that wins
   * that update releases the cupo, so `liberarPendientesAbandonados` can never
   * release it a second time.
   */
  private async abortarRegistro(
    origen: OrigenResuelto,
    reservas: Reserva[],
    valeId: Types.ObjectId | undefined,
    error: unknown,
  ): Promise<void> {
    if (!valeId) {
      await this.liberar(origen, reservas);
      return;
    }
    try {
      const marcado = await this.devolucionModel
        .findOneAndUpdate(
          { _id: valeId, estado: EstadoDevolucion.PENDIENTE },
          {
            $set: {
              estado: EstadoDevolucion.FALLIDA,
              errorAplicacion:
                error instanceof ConflictException
                  ? 'El origen dejó de estar vigente'
                  : error instanceof Error
                    ? error.message
                    : String(error),
            },
          },
        )
        .exec();
      if (marcado) await this.liberar(origen, reservas);
    } catch (e) {
      // The vale stays `pendiente` holding its cupo: the recovery job marks it
      // `fallida` and releases the cupo exactly once.
      this.logger.error(
        `No se pudo marcar fallida la devolución ${String(valeId)}; la recuperación liberará su cupo: ${String(e)}`,
      );
    }
  }

  /**
   * Mueve el stock y escribe el Kardex del vale. Es idempotente: solo la
   * llamada que logra pasar el vale de `pendiente` a `aplicando` (escritura
   * condicional) mueve algo; cualquier otra devuelve el vale como está.
   *
   * Si algo falla se deshace lo ya movido, se borra el Kardex escrito, se
   * libera el cupo del origen y el vale queda `fallida` (evidencia). Un
   * vale nunca queda con stock movido sin documento: el documento existe
   * antes de mover nada.
   */
  async aplicar(id: string): Promise<DevolucionPersistida> {
    const reclamada = await this.devolucionModel
      .findOneAndUpdate(
        { _id: id, estado: EstadoDevolucion.PENDIENTE },
        { $set: { estado: EstadoDevolucion.APLICANDO } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();

    if (!reclamada) {
      return this.findOne(id);
    }

    const vale = reclamada as DevolucionPersistida;
    const aplicados: MovimientoAplicado[] = [];

    try {
      const unificado = await this.existenciaService.estaUnificado();
      const esProveedor = vale.tipo === DevolucionTipo.PROVEEDOR;

      for (const linea of vale.lineas) {
        if (linea.cantidadEntregada <= EPSILON) continue;

        const movido = await this.moverStock(
          linea,
          esProveedor ? 'sale' : 'entra',
          unificado,
          aplicados,
        );
        await this.escribirKardex(vale, linea, movido);
      }
    } catch (error) {
      await this.deshacer(aplicados);
      await this.kardexModel
        .deleteMany({ referencia: vale.numeroConsecutivo })
        .exec()
        .catch((e: unknown) =>
          this.logger.error(
            `No se pudo borrar el Kardex de la devolución fallida ${vale.numeroConsecutivo}, corregir a mano: ${String(e)}`,
          ),
        );
      const marcada = await this.devolucionModel
        .findOneAndUpdate(
          { _id: vale._id, estado: EstadoDevolucion.APLICANDO },
          {
            $set: {
              estado: EstadoDevolucion.FALLIDA,
              errorAplicacion:
                error instanceof Error ? error.message : String(error),
            },
          },
          { returnDocument: 'after' },
        )
        .lean()
        .exec();
      if (marcada) {
        // Quien marca `fallida` libera el cupo: una sola vez.
        await this.liberarVale(vale);
      }
      throw error;
    }

    const registrada = await this.devolucionModel
      .findOneAndUpdate(
        { _id: vale._id, estado: EstadoDevolucion.APLICANDO },
        { $set: { estado: EstadoDevolucion.REGISTRADA } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();

    if (!registrada) {
      this.logger.error(
        `Devolución ${vale.numeroConsecutivo}: el stock y el Kardex se aplicaron pero no se pudo marcar registrada; revisar a mano`,
      );
      throw new ConflictException(
        `La devolución ${vale.numeroConsecutivo} cambió de estado mientras se aplicaba`,
      );
    }

    return registrada;
  }

  /**
   * Un proceso que muere a mitad de `aplicar` deja el vale en `aplicando`
   * para siempre (bloquea la cancelación de la factura y retiene el cupo).
   * Sin transacciones no se puede saber qué movió, así que solo se resuelve
   * el caso inequívoco: si el Kardex de TODAS las líneas ya está escrito, el
   * stock se movió entero y solo falta cerrar el vale. El resto se deja como
   * está (conservar el cupo es lo seguro) y se avisa para revisión manual.
   */
  async recuperarInterrumpidas(
    antiguedadMs = ANTIGUEDAD_APLICANDO_MS,
  ): Promise<{ registradas: number; enRevision: number; liberadas: number }> {
    const limite = new Date(Date.now() - antiguedadMs);
    const liberadas = await this.liberarPendientesAbandonados(limite);

    const atascados = await this.devolucionModel
      .find({ estado: EstadoDevolucion.APLICANDO, updatedAt: { $lt: limite } })
      .lean()
      .exec();

    let registradas = 0;
    let enRevision = 0;
    for (const vale of atascados as DevolucionPersistida[]) {
      const esperadas = vale.lineas
        .filter((l) => l.cantidadEntregada > EPSILON)
        .map((l) => String(l.producto));
      const escritas = new Set(
        (
          (await this.kardexModel
            .find({ referencia: vale.numeroConsecutivo })
            .select('productoId')
            .lean()
            .exec()) as unknown as { productoId: unknown }[]
        ).map((k) => String(k.productoId)),
      );
      const completo =
        esperadas.length > 0 && esperadas.every((p) => escritas.has(p));
      if (completo) {
        const cerrada = await this.devolucionModel
          .findOneAndUpdate(
            { _id: vale._id, estado: EstadoDevolucion.APLICANDO },
            { $set: { estado: EstadoDevolucion.REGISTRADA } },
          )
          .exec();
        if (cerrada) {
          registradas++;
          this.logger.warn(
            `Devolución ${vale.numeroConsecutivo}: aplicación interrumpida con el Kardex completo; marcada registrada`,
          );
          continue;
        }
      }
      enRevision++;
      this.logger.error(
        `Devolución ${vale.numeroConsecutivo} lleva en "aplicando" desde ${String((vale as { updatedAt?: Date }).updatedAt)} con ${esperadas.filter((p) => escritas.has(p)).length}/${esperadas.length} líneas en el Kardex: revisar el stock a mano`,
      );
    }
    return { registradas, enRevision, liberadas };
  }

  /**
   * Un vale `pendiente` no movió nada (`aplicar` lo pasa a `aplicando` antes de
   * tocar el stock): si el proceso murió justo después de crearlo, solo retiene
   * cupo. Se marca `fallida` (quien lo marca libera el cupo, una sola vez) y la
   * persona puede registrar la devolución de nuevo.
   */
  private async liberarPendientesAbandonados(limite: Date): Promise<number> {
    const abandonados = (await this.devolucionModel
      .find({ estado: EstadoDevolucion.PENDIENTE, updatedAt: { $lt: limite } })
      .lean()
      .exec()) as DevolucionPersistida[];

    let liberadas = 0;
    for (const vale of abandonados) {
      const marcado = await this.devolucionModel
        .findOneAndUpdate(
          { _id: vale._id, estado: EstadoDevolucion.PENDIENTE },
          {
            $set: {
              estado: EstadoDevolucion.FALLIDA,
              errorAplicacion:
                'Vale pendiente abandonado: nunca llegó a aplicarse',
            },
          },
        )
        .exec();
      if (!marcado) continue;
      await this.liberarVale(vale);
      liberadas++;
      this.logger.warn(
        `Devolución ${vale.numeroConsecutivo}: vale pendiente abandonado; cupo liberado`,
      );
    }
    return liberadas;
  }

  // ─── Consultas ───────────────────────────────────────────────────

  async listar(query: ListarDevolucionesQueryDto): Promise<{
    datos: DevolucionPersistida[];
    total: number;
    pagina: number;
    limite: number;
  }> {
    const pagina = query.pagina ?? 1;
    const limite = query.limite ?? DEVOLUCION_LIMITE_DEFECTO;

    // Por defecto solo las que de verdad movieron stock y dinero.
    const filtro: Record<string, unknown> = {
      estado: query.estado ?? EstadoDevolucion.REGISTRADA,
    };
    if (query.formaDevolucionDinero) {
      filtro.formaDevolucionDinero = query.formaDevolucionDinero;
    }
    if (query.tipo) filtro.tipo = query.tipo;
    if (query.origenRef) filtro.origenRef = new Types.ObjectId(query.origenRef);

    const fecha = this.rangoFechas(query.desde, query.hasta);
    if (fecha) filtro.fecha = fecha;

    const [datos, total] = await Promise.all([
      this.devolucionModel
        .find(filtro)
        .sort({ fecha: -1, _id: -1 })
        .skip((pagina - 1) * limite)
        .limit(limite)
        .lean()
        .exec(),
      this.devolucionModel.countDocuments(filtro).exec(),
    ]);

    return { datos: datos, total, pagina, limite };
  }

  async findOne(id: string): Promise<DevolucionPersistida> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('El ID de la devolución no es válido');
    }
    const vale = await this.devolucionModel.findById(id).lean().exec();
    if (!vale) {
      throw new NotFoundException('La devolución no existe');
    }
    return vale;
  }

  // ─── Validación ──────────────────────────────────────────────────

  private validarForma(dto: CreateDevolucionDto, origen: OrigenResuelto): void {
    if (!dto.formaDevolucionDinero) return;

    if (origen.tipo === DevolucionTipo.PROVEEDOR) {
      throw new BadRequestException(
        'Una devolución a proveedor no tiene forma de devolución de dinero al cliente',
      );
    }
    if (dto.formaDevolucionDinero !== origen.formaDinero) {
      throw new BadRequestException(
        `La forma "${dto.formaDevolucionDinero}" no es coherente con el pago original (${origen.pagoOriginal ?? 'desconocido'}): corresponde "${origen.formaDinero}"`,
      );
    }
  }

  /** Líneas del vale con el precio y el importe que calcula el servidor. */
  private prepararLineas(dto: CreateDevolucionDto, origen: OrigenResuelto) {
    const vistos = new Set<string>();

    const lineas = dto.lineas.map((l) => {
      const productoHex = new Types.ObjectId(l.producto).toHexString();

      if (vistos.has(productoHex)) {
        throw new BadRequestException(
          'Un producto no puede repetirse en el vale; sume sus cantidades en una sola línea',
        );
      }
      vistos.add(productoHex);

      const deOrigen = origen.productos.get(productoHex);
      if (!deOrigen) {
        throw new BadRequestException(
          `El producto ${productoHex} no pertenece al documento de origen`,
        );
      }
      if (
        !Number.isFinite(l.cantidadEntregada) ||
        !Number.isFinite(l.cantidadSolicitada)
      ) {
        throw new BadRequestException(
          'Las cantidades deben ser números válidos',
        );
      }
      if (l.cantidadSolicitada <= 0) {
        throw new BadRequestException(
          'La cantidad solicitada debe ser mayor que 0',
        );
      }
      if (l.cantidadEntregada > l.cantidadSolicitada + EPSILON) {
        throw new BadRequestException(
          'La cantidad entregada no puede superar la solicitada',
        );
      }

      return {
        productoHex,
        cantidadSolicitada: redondear(l.cantidadSolicitada),
        cantidadEntregada: redondear(l.cantidadEntregada),
        precioUnitario: deOrigen.precioUnitario,
        importe: redondear2(
          deOrigen.precioUnitario *
            l.cantidadEntregada *
            (deOrigen.factorImpuesto ?? origen.factorImpuesto),
        ),
      };
    });

    if (!lineas.some((l) => l.cantidadEntregada > EPSILON)) {
      throw new BadRequestException(
        'La devolución debe entregar al menos una cantidad mayor que 0',
      );
    }

    return lineas;
  }

  // ─── Cupo acumulado por origen ───────────────────────────────────

  private claveAcumulado(origen: OrigenResuelto, productoId: string) {
    return {
      origenTipo: origen.origenTipo,
      origenId: origen.origenId.toHexString(),
      productoId,
    };
  }

  /**
   * Reserva, línea a línea, la cantidad en el acumulado del origen con UNA
   * escritura condicional (`devuelta <= vendida - cantidad`). Si una línea
   * no cabe, se libera lo ya reservado y se rechaza.
   */
  private async reservar(
    origen: OrigenResuelto,
    lineas: { productoHex: string; cantidadEntregada: number }[],
  ): Promise<Reserva[]> {
    const reservas: Reserva[] = [];

    for (const linea of lineas) {
      if (linea.cantidadEntregada <= EPSILON) continue;

      const vendida = origen.productos.get(linea.productoHex)?.vendida ?? 0;
      const clave = this.claveAcumulado(origen, linea.productoHex);

      try {
        await this.asegurarContador(clave, vendida);

        const antes =
          redondear(vendida - linea.cantidadEntregada) >= 0
            ? await this.acumuladoModel
                .findOneAndUpdate(
                  {
                    ...clave,
                    devuelta: {
                      $lte:
                        redondear(vendida - linea.cantidadEntregada) +
                        TOLERANCIA_SALDO,
                    },
                  },
                  { $inc: { devuelta: linea.cantidadEntregada } },
                )
                .lean()
                .exec()
            : null;

        if (!antes) {
          throw await this.errorTope(clave, vendida, linea);
        }

        reservas.push({
          productoId: linea.productoHex,
          cantidad: linea.cantidadEntregada,
          previo: redondear(Number(antes.devuelta) || 0),
        });
      } catch (error) {
        await this.liberar(origen, reservas);
        throw error;
      }
    }

    return reservas;
  }

  /** Crea el contador del producto en el origen si no existe (idempotente y a prueba de carreras). */
  private async asegurarContador(
    clave: { origenTipo: string; origenId: string; productoId: string },
    vendida: number,
  ): Promise<void> {
    try {
      await this.acumuladoModel
        .updateOne(
          clave,
          { $setOnInsert: { vendida, devuelta: 0 } },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      // Otro cajero lo creó a la vez: el contador ya existe.
      if (!esClaveDuplicada(error)) throw error;
    }
  }

  private async errorTope(
    clave: { origenTipo: string; origenId: string; productoId: string },
    vendida: number,
    linea: { cantidadEntregada: number },
  ): Promise<BadRequestException> {
    const [contador, producto] = await Promise.all([
      this.acumuladoModel.findOne(clave).lean().exec(),
      this.productoModel
        .findById(clave.productoId)
        .select('nombre_producto')
        .lean()
        .exec(),
    ]);
    const nombre = producto?.nombre_producto
      ? `"${producto.nombre_producto}"`
      : clave.productoId;

    return new BadRequestException(
      `No se pueden devolver ${linea.cantidadEntregada} de ${nombre}: el origen tiene ${vendida} y ya se devolvieron ${redondear(Number(contador?.devuelta) || 0)}`,
    );
  }

  private async liberar(
    origen: OrigenResuelto,
    reservas: Reserva[],
  ): Promise<void> {
    for (const r of reservas) {
      const clave = this.claveAcumulado(origen, r.productoId);
      // `devuelta` never goes below 0: subtract only when there is enough,
      // otherwise clamp to 0 (a second release must not mint extra cupo).
      await this.acumuladoModel
        .updateOne(
          { ...clave, devuelta: { $gte: r.cantidad } },
          { $inc: { devuelta: -r.cantidad } },
        )
        .exec()
        .then((res) =>
          res.matchedCount > 0
            ? undefined
            : this.acumuladoModel
                .updateOne(
                  { ...clave, devuelta: { $gt: 0 } },
                  { $set: { devuelta: 0 } },
                )
                .exec(),
        )
        .catch((e: unknown) =>
          this.logger.error(
            `No se pudo liberar el cupo devuelto (${r.productoId}, ${r.cantidad}), corregir a mano: ${String(e)}`,
          ),
        );
    }
  }

  /** Libera el cupo de un vale ya persistido (cuando su aplicación falló). */
  private async liberarVale(vale: DevolucionPersistida): Promise<void> {
    const reservas = vale.lineas
      .filter((l) => l.cantidadEntregada > EPSILON)
      .map((l) => ({
        productoId: new Types.ObjectId(String(l.producto)).toHexString(),
        cantidad: l.cantidadEntregada,
        previo: 0,
      }));
    await this.liberar(
      {
        origenTipo: vale.origenTipo,
        origenId: new Types.ObjectId(String(vale.origenRef)),
      } as OrigenResuelto,
      reservas,
    );
  }

  // ─── Movimiento de stock ─────────────────────────────────────────

  /**
   * Mueve el stock de una línea y devuelve el total del producto después.
   * Devolución de venta: repone a las ubicaciones del origen. Devolución a
   * proveedor: descuenta de donde quedó lo comprado. Registra cada paso en
   * `aplicados` para poder deshacerlo.
   */
  private async moverStock(
    linea: LineaDevolucion,
    sentido: 'entra' | 'sale',
    unificado: boolean,
    aplicados: MovimientoAplicado[],
  ): Promise<StockMovido> {
    const productoId = new Types.ObjectId(String(linea.producto)).toHexString();

    if (!unificado) {
      const stock = await this.moverStockLegacy(
        productoId,
        linea.cantidadEntregada,
        sentido,
      );
      aplicados.push({
        productoId,
        sentido,
        ubicaciones: [],
        cantidadLegacy: linea.cantidadEntregada,
      });
      return { stock, ubicaciones: [] };
    }

    let total = 0;
    const tocadas: UbicacionCantidad[] = [];
    const registrar = (mov: ResultadoMovimiento): void => {
      aplicados.push({ productoId, sentido, ubicaciones: mov.ubicaciones });
      tocadas.push(...mov.ubicaciones);
      total = mov.stockTotal;
    };

    if (sentido === 'entra') {
      if (linea.ubicaciones.length > 0) {
        registrar(
          await this.existenciaService.reponerProducto({
            productoId,
            ubicaciones: linea.ubicaciones.map((u) => ({
              almacen: u.almacen,
              contenedor: u.contenedor,
              cantidad: u.cantidad,
            })),
          }),
        );
      }
      if (linea.sinUbicacion > EPSILON) {
        registrar(
          await this.existenciaService.reponerProducto({
            productoId,
            cantidad: linea.sinUbicacion,
          }),
        );
      }
    } else {
      for (const u of linea.ubicaciones) {
        registrar(
          await this.existenciaService.descontarProducto({
            productoId,
            cantidad: u.cantidad,
            almacenId: u.almacen,
            contenedorId: u.contenedor,
          }),
        );
      }
      if (linea.sinUbicacion > EPSILON) {
        registrar(
          await this.existenciaService.descontarProducto({
            productoId,
            cantidad: linea.sinUbicacion,
          }),
        );
      }
    }

    return { stock: total, ubicaciones: tocadas };
  }

  /** Antes de unificar existencias el saldo vive en `Producto.stock_inicial`. */
  private async moverStockLegacy(
    productoId: string,
    cantidad: number,
    sentido: 'entra' | 'sale',
  ): Promise<number> {
    const producto = await this.productoModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(productoId),
          ...(sentido === 'sale' ? { stock_inicial: { $gte: cantidad } } : {}),
        },
        { $inc: { stock_inicial: sentido === 'entra' ? cantidad : -cantidad } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();

    if (!producto) {
      throw new ConflictException(
        sentido === 'sale'
          ? `Stock insuficiente para devolver ${cantidad} al proveedor (producto ${productoId})`
          : `El producto ${productoId} no existe`,
      );
    }

    return Math.max(0, redondear(Number(producto.stock_inicial) || 0));
  }

  /**
   * Submayor SC-2-13: la ubicación de cada destino (separadas por `; `). Antes
   * de unificar no hay ubicaciones por movimiento: se usa la ubicación por
   * defecto del producto.
   */
  private async ubicacionFisica(
    ubicaciones: UbicacionCantidad[],
    porDefecto: { almacen?: unknown; contenedor?: unknown },
  ): Promise<string | undefined> {
    const destinos = new Map<
      string,
      { almacen?: unknown; contenedor?: unknown }
    >();
    for (const u of ubicaciones) {
      destinos.set(`${String(u.almacen)}:${String(u.contenedor)}`, u);
    }
    if (destinos.size === 0) destinos.set('defecto', porDefecto);

    const textos: string[] = [];
    for (const d of destinos.values()) {
      const texto = await ubicacionFisicaDe(
        this.almacenModel,
        this.contenedorModel,
        d.almacen as Types.ObjectId | string | undefined,
        d.contenedor as Types.ObjectId | string | undefined,
      );
      if (texto && !textos.includes(texto)) textos.push(texto);
    }
    return textos.length > 0 ? textos.join('; ') : undefined;
  }

  private async escribirKardex(
    vale: DevolucionPersistida,
    linea: LineaDevolucion,
    movido: StockMovido,
  ): Promise<void> {
    const proveedor = vale.tipo === DevolucionTipo.PROVEEDOR;
    const productoId = new Types.ObjectId(String(linea.producto));
    const producto = await this.productoModel
      .findById(productoId)
      .select('precio_compra almacen contenedor')
      .lean()
      .exec();
    // La devolución no cambia el promedio: se valúa al vigente.
    const costo = costoVigente(
      await ultimoCostoPromedio(this.kardexModel, productoId),
      producto?.precio_compra,
    );
    const valuacion = valuarMovimiento(linea.cantidadEntregada, costo);
    const ubicacionFisica = await this.ubicacionFisica(movido.ubicaciones, {
      almacen: producto?.almacen,
      contenedor: producto?.contenedor,
    });
    const stock = movido.stock;

    await this.kardexModel.create({
      productoId: new Types.ObjectId(String(linea.producto)),
      // Devolución de venta: tipo propio. A proveedor: una SALIDA con su
      // motivo, nunca una compra negativa.
      tipo: proveedor ? KardexTipo.SALIDA : KardexTipo.DEVOLUCION,
      cantidad: linea.cantidadEntregada,
      stock: Math.max(0, stock),
      motivo: proveedor
        ? `Devolución a proveedor: ${vale.motivo}`
        : `Devolución de ${vale.origenTipo}: ${vale.motivo}`,
      referencia: vale.numeroConsecutivo,
      // Sin costo conocido se conserva el importe devuelto (CUP); si la
      // devolución es en divisa, ese importe va a `importeDivisa`.
      ...(vale.moneda === 'CUP' && linea.importe > 0
        ? { importeCUP: linea.importe }
        : {}),
      ...(vale.moneda !== 'CUP' && linea.importe > 0
        ? { importeDivisa: linea.importe }
        : {}),
      ...valuacion,
      ...(ubicacionFisica ? { ubicacionFisica } : {}),
    });
  }

  /** Deshace en orden inverso los movimientos ya aplicados; un fallo se registra y sigue. */
  private async deshacer(aplicados: MovimientoAplicado[]): Promise<void> {
    for (const mov of [...aplicados].reverse()) {
      try {
        if (mov.cantidadLegacy !== undefined) {
          await this.productoModel
            .updateOne(
              { _id: new Types.ObjectId(mov.productoId) },
              {
                $inc: {
                  stock_inicial:
                    mov.sentido === 'entra'
                      ? -mov.cantidadLegacy
                      : mov.cantidadLegacy,
                },
              },
            )
            .exec();
        } else if (mov.sentido === 'entra') {
          for (const u of mov.ubicaciones) {
            await this.existenciaService.descontarProducto({
              productoId: mov.productoId,
              cantidad: u.cantidad,
              almacenId: u.almacen,
              contenedorId: u.contenedor,
            });
          }
        } else {
          await this.existenciaService.reponerProducto({
            productoId: mov.productoId,
            ubicaciones: mov.ubicaciones,
          });
        }
      } catch (error) {
        this.logger.error(
          `No se pudo deshacer el movimiento de stock de la devolución (producto ${mov.productoId}), corregir a mano: ${String(error)}`,
        );
      }
    }
  }

  // ─── Fechas ──────────────────────────────────────────────────────

  private rangoFechas(
    desde?: string,
    hasta?: string,
  ): Record<string, Date> | undefined {
    const rango: Record<string, Date> = {};
    const soloFecha = /^\d{4}-\d{2}-\d{2}$/;

    if (desde) rango.$gte = new Date(desde);
    if (hasta) {
      if (soloFecha.test(hasta)) {
        const siguiente = new Date(hasta);
        siguiente.setUTCDate(siguiente.getUTCDate() + 1);
        rango.$lt = siguiente;
      } else {
        rango.$lte = new Date(hasta);
      }
    }

    return Object.keys(rango).length > 0 ? rango : undefined;
  }
}
