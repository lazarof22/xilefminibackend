import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  esClaveDuplicada,
  insertarIgnorandoDuplicados,
} from '../../../../common/utils/insertar-idempotente';
import { ConfiguracionTributariaService } from '../../../configuracion-tributaria/configuracion-tributaria.service';
import { Cliente } from '../../../clientes y provedores/cliente/schemas/cliente.schema';
import { redondear } from '../../../factura/factura-totales';
import type { JwtUser } from '../../../auth/types/jwt-user.type';
import { huellaDe } from '../../../operacion-idempotente/huella';
import {
  ManejadorOperacion,
  OperacionIdempotenteService,
  OperacionLean,
  OperacionPerdidaError,
} from '../../../operacion-idempotente/operacion-idempotente.service';
import { EstadoOperacion } from '../../../operacion-idempotente/schema/operacion-idempotente.schema';
import { ExistenciaService } from '../../exitencia/existencia.service';
import type { ResultadoMovimiento } from '../../exitencia/existencia.types';
import { Kardex, KardexTipo } from '../../kardex/schema/kardex.schema';
import { PagoService } from '../../pago/pago.service';
import { Producto } from '../../producto/schemas/producto.schema';
import {
  MetodoPagoReporte,
  OrigenReporte,
} from '../../reporte_plus/schema/reporte_plus.schema';
import { ReportePlusService } from '../../reporte_plus/reporte_plus.service';
import { CreateCheckoutDto } from '../dto/create-checkout.dto';
import {
  CONTADOR_COMPROBANTE_POS,
  VentaContador,
} from '../schema/venta-contador.schema';
import { Venta } from '../schema/venta.schema';
import { descuentoMaximoPara, validarDescuentos } from './checkout-politica';
import { calcularVenta, EntradaLinea } from './checkout-totales';
import {
  AMBITO_CHECKOUT,
  cuerpoError,
  estadoDeStock,
  leerPlan,
  PlanCheckout,
  RespuestaCheckout,
  ResultadoLinea,
} from './checkout.types';

export interface ResultadoCheckout {
  respuesta: RespuestaCheckout;
  /** true si es la respuesta guardada de una petición anterior con la misma clave. */
  repetida: boolean;
}

/** Qué pasó al intentar devolver el stock de una operación que no llegó a confirmarse. */
export interface ResultadoReversa {
  devueltas: number;
  /** Líneas en las que no se sabe si el descuento llegó a aplicarse. */
  ambiguas: number[];
  /** Líneas cuya devolución falló. */
  fallidas: number[];
  detalle: string[];
}

const dormir = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Quita los `undefined` (el driver los guardaría como `null`) conservando
 * ObjectId y fechas, para guardar planes y respuestas en la base.
 */
function sinIndefinidos<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return (valor as unknown[]).map((v) => sinIndefinidos(v)) as unknown as T;
  }

  if (
    valor !== null &&
    typeof valor === 'object' &&
    Object.getPrototypeOf(valor) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, sinIndefinidos(v)]),
    ) as T;
  }

  return valor;
}

/**
 * POST /venta/checkout: una sola petición que cobra y descuenta (Fase 2).
 *
 * Qué garantiza (y qué no) sobre MongoDB autónomo, que NO tiene transacciones:
 *
 *  1. Totales: los calcula el servidor con los precios y el impuesto vigentes;
 *     lo que el cliente crea que es el total no se usa.
 *  2. Sin duplicados: la clave `Idempotency-Key` se registra con un índice
 *     único; un reintento recibe la respuesta guardada (o espera a la
 *     primera) y nunca crea una segunda venta ni un segundo pago.
 *  3. Sin sobreventa: el stock se descuenta con actualizaciones condicionales
 *     (`cantidad >= n`), así dos cajeros no venden la misma última unidad.
 *  4. Recuperable: antes de tocar nada se guarda el PLAN completo (con los
 *     `_id` de lo que se va a crear) y se anota en un registro de pasos cada
 *     escritura sobre el stock, ANTES y DESPUÉS de hacerla. Orden:
 *       a) reservar el stock línea a línea (aquí se puede revertir);
 *       b) punto de no retorno: número de comprobante y respuesta final;
 *       c) pago, venta, Kardex y Reporte Plus, todos con `_id` fijado y
 *          repetibles (aquí solo se avanza hasta terminar).
 *     Si el servidor se cae, al arrancar la recuperación lee el registro: antes
 *     de (b) devuelve lo reservado; desde (b) termina lo que faltó.
 *
 *  Límite conocido: si la caída ocurre justo entre el anotado "voy a descontar"
 *  y el "descontado", no se puede saber si el descuento se aplicó. En ese caso
 *  (y si falla una devolución) la operación pasa a estado `revision` con el
 *  detalle, y no se toca el stock a ciegas. La conciliación de existencias
 *  (Fase 1) detecta cualquier desfase que eso deje.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  /** Veces que se reintenta la confirmación antes de dejarla a la recuperación. */
  reintentosConfirmacion = 3;
  pausaReintentoMs = 150;

  constructor(
    @InjectModel(Venta.name) private readonly ventaModel: Model<Venta>,
    @InjectModel(Cliente.name) private readonly clienteModel: Model<Cliente>,
    @InjectModel(Producto.name)
    private readonly productoModel: Model<Producto>,
    @InjectModel(Kardex.name) private readonly kardexModel: Model<Kardex>,
    @InjectModel(VentaContador.name)
    private readonly contadorModel: Model<VentaContador>,
    private readonly idem: OperacionIdempotenteService,
    private readonly existencia: ExistenciaService,
    private readonly pagos: PagoService,
    private readonly reportePlus: ReportePlusService,
    private readonly tributaria: ConfiguracionTributariaService,
  ) {}

  /** Lo que la pantalla necesita saber del servidor para mostrar un estimado fiel. */
  async parametros(
    usuario: JwtUser,
  ): Promise<{ impuestoPorciento: number; descuentoMaximoPct: number }> {
    return {
      impuestoPorciento: await this.tributaria.obtenerImpuestoVentas(),
      descuentoMaximoPct: descuentoMaximoPara(usuario.rol),
    };
  }

  async ejecutar(
    dto: CreateCheckoutDto,
    claveCabecera: string | undefined,
    usuario: JwtUser,
  ): Promise<ResultadoCheckout> {
    const clave = this.validarClave(claveCabecera);
    // El estimado del cliente es informativo: no forma parte de la operación.
    const huella = huellaDe({ ...dto, estimado: undefined });

    const inicio = await this.idem.iniciar({
      clave,
      ambito: AMBITO_CHECKOUT,
      huella,
      usuarioId: usuario.userId,
    });

    if (inicio.tipo === 'nueva') {
      const respuesta = await this.procesar(inicio.operacion, dto, usuario);
      return { respuesta, repetida: false };
    }

    return this.resolverExistente(inicio.operacion);
  }

  private validarClave(clave: string | undefined): string {
    const limpia = clave?.trim();

    if (
      !limpia ||
      limpia.length < 8 ||
      limpia.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(limpia)
    ) {
      throw new BadRequestException(
        'Falta la cabecera Idempotency-Key (de 8 a 128 caracteres: letras, números y . _ : -). Genere un UUID una sola vez por operación.',
      );
    }

    return limpia;
  }

  // ───────────────────── Reintento de una operación existente ─────────────────────

  private async resolverExistente(
    existente: OperacionLean,
  ): Promise<ResultadoCheckout> {
    let operacion: OperacionLean | null = existente;

    if (operacion.estado === EstadoOperacion.EN_PROCESO) {
      operacion = await this.idem.esperarFin(operacion.clave);
    }

    switch (operacion?.estado) {
      case EstadoOperacion.COMPLETADA: {
        const guardada = operacion.respuesta as unknown as RespuestaCheckout;
        return {
          respuesta: {
            ...guardada,
            idempotencia: { ...guardada.idempotencia, repetida: true },
          },
          repetida: true,
        };
      }

      case EstadoOperacion.FALLIDA: {
        // La misma falla que tuvo la ejecución original, con su mismo cuerpo.
        const error = operacion.error;
        throw new HttpException(
          (error?.cuerpo as string | Record<string, unknown>) ?? 'Error',
          error?.codigoHttp ?? 500,
        );
      }

      case EstadoOperacion.REVISION:
        throw new ConflictException(
          cuerpoError(
            409,
            'Conflict',
            'Esta operación quedó en revisión: el administrador debe comprobar el stock antes de repetirla. No la reenvíe.',
            'OPERACION_EN_REVISION',
          ),
        );

      default:
        throw new ConflictException(
          cuerpoError(
            409,
            'Conflict',
            'La operación con esta clave sigue en proceso. Espere unos segundos y reintente con la misma clave.',
            'OPERACION_EN_PROCESO',
          ),
        );
    }
  }

  // ───────────────────────────── Ejecución ─────────────────────────────

  private async procesar(
    operacion: OperacionLean,
    dto: CreateCheckoutDto,
    usuario: JwtUser,
  ): Promise<RespuestaCheckout> {
    const op = this.idem.manejador(operacion);

    try {
      // 1) Todo lo que puede rechazarse, ANTES de tocar nada.
      const plan = await this.prepararPlan(dto, usuario);
      await this.idem.registrarPlan(
        op,
        sinIndefinidos(plan) as unknown as Record<string, unknown>,
      );

      // 2) Reservar el stock (todavía reversible).
      const resultados = await this.reservarStock(op, plan);

      // 3) Punto de no retorno: número de comprobante y respuesta final.
      const comprobante = await this.siguienteComprobante();
      const respuesta = this.armarRespuesta(
        plan,
        comprobante,
        resultados,
        op.clave,
      );
      await this.idem.marcarConfirmando(
        op,
        sinIndefinidos(respuesta) as unknown as Record<string, unknown>,
      );

      // 4) Pago, venta, Kardex y Reporte Plus (solo hacia adelante).
      await this.confirmarConReintentos(
        op,
        plan,
        comprobante,
        resultados,
        respuesta,
      );

      this.avisarStockBajo(plan, resultados);
      return respuesta;
    } catch (error) {
      return this.manejarFallo(op, error);
    }
  }

  /**
   * Lee y valida todo lo que la venta necesita y decide TODO lo que se va a
   * crear (incluidos los `_id`). No escribe nada: cualquier rechazo (producto
   * inexistente, descuento no permitido, pago inválido, total cero...) ocurre
   * antes de tocar el stock.
   */
  private async prepararPlan(
    dto: CreateCheckoutDto,
    usuario: JwtUser,
  ): Promise<PlanCheckout> {
    const idsProducto = dto.items.map((i) =>
      new Types.ObjectId(i.productoId).toHexString(),
    );

    if (new Set(idsProducto).size !== idsProducto.length) {
      throw new BadRequestException(
        'Hay productos repetidos en la venta: sume sus cantidades en una sola línea',
      );
    }

    validarDescuentos(
      dto.items.map((i) => i.descuentoPct ?? 0),
      usuario.rol,
    );

    const cliente = dto.clienteId
      ? await this.buscarCliente(dto.clienteId)
      : undefined;

    const productos = await this.productoModel
      .find({ _id: { $in: idsProducto.map((id) => new Types.ObjectId(id)) } })
      .lean()
      .exec();
    const productoPorId = new Map(productos.map((p) => [String(p._id), p]));

    const entradas: EntradaLinea[] = dto.items.map((item, i) => {
      const producto = productoPorId.get(idsProducto[i]);

      if (!producto) {
        throw new NotFoundException(
          `Producto no encontrado (${item.productoId})`,
        );
      }

      return {
        producto: {
          _id: producto._id,
          codigo_producto: producto.codigo_producto,
          nombre_producto: producto.nombre_producto,
          precio_venta: producto.precio_venta,
          stock_minimo: producto.stock_minimo,
        },
        cantidad: item.cantidad,
        descuentoPct: item.descuentoPct ?? 0,
      };
    });

    const unificado = await this.existencia.estaUnificado();
    const impuestoPorciento = await this.tributaria.obtenerImpuestoVentas();
    const { lineas, totales } = calcularVenta(entradas, impuestoPorciento);

    if (totales.total <= 0) {
      throw new BadRequestException(
        'El total de la venta debe ser mayor que 0',
      );
    }

    const pago = this.pagos.prepararPagoCheckout(
      dto.pago,
      totales.total,
      cliente?._id,
    );

    const advertencias: string[] = [];
    const almacenId = dto.almacenId;
    const contenedorId = dto.ubicacionOrigen?.contenedorId;

    if (!unificado && (almacenId || contenedorId)) {
      advertencias.push(
        'Se ignoró la ubicación de origen: el inventario todavía no está unificado, el stock sale del total del producto',
      );
    }

    const diferencias = this.compararEstimado(dto, totales);
    if (diferencias) advertencias.push(diferencias);

    return {
      version: 1,
      fecha: new Date(),
      unificado,
      usuario: { id: usuario.userId, nombre: usuario.nombre, rol: usuario.rol },
      clienteId: cliente?._id,
      clienteNombre: cliente?.nombre_cliente,
      origen: unificado ? { almacenId, contenedorId } : {},
      lineas: lineas.map((l, i) => ({
        ...l,
        stockMinimo: entradas[i].producto.stock_minimo,
        kardexId: new Types.ObjectId(),
        reporteId: new Types.ObjectId(),
      })),
      totales,
      pago,
      ventaId: new Types.ObjectId(),
      pagoId: new Types.ObjectId(),
      advertencias,
    };
  }

  private async buscarCliente(
    clienteId: string,
  ): Promise<{ _id: Types.ObjectId; nombre_cliente?: string }> {
    const cliente = await this.clienteModel
      .findById(new Types.ObjectId(clienteId))
      .lean()
      .exec();

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return {
      _id: cliente._id,
      nombre_cliente: (cliente as { nombre_cliente?: string }).nombre_cliente,
    };
  }

  /** Avisa (sin bloquear) si lo que la pantalla mostró no coincide con lo que calculó el servidor. */
  private compararEstimado(
    dto: CreateCheckoutDto,
    totales: {
      subtotal: number;
      descuento: number;
      impuesto: number;
      total: number;
    },
  ): string | undefined {
    const estimado = dto.estimado;
    if (!estimado) return undefined;

    const difiere = (mostrado: number | undefined, real: number): boolean =>
      mostrado !== undefined && Math.abs(mostrado - real) >= 0.01;

    if (
      difiere(estimado.subtotal, totales.subtotal) ||
      difiere(estimado.descuento, totales.descuento) ||
      difiere(estimado.impuesto, totales.impuesto) ||
      difiere(estimado.total, totales.total)
    ) {
      return `Los totales mostrados no coinciden con los del servidor (total ${totales.total.toFixed(2)}): se cobró con los del servidor`;
    }

    return undefined;
  }

  /**
   * Descuenta el stock de cada línea, anotando en el registro de pasos "voy a
   * descontar" ANTES y "descontado" (con de dónde salió) DESPUÉS. Si una línea
   * falla, el error sube y `manejarFallo` devuelve las anteriores.
   */
  private async reservarStock(
    op: ManejadorOperacion,
    plan: PlanCheckout,
  ): Promise<Map<number, ResultadoLinea>> {
    const resultados = new Map<number, ResultadoLinea>();

    for (const linea of plan.lineas) {
      await this.idem.registrarPaso(op, 'stock', 'iniciado', {
        linea: linea.indice,
        datos: {
          productoId: linea.productoId.toHexString(),
          cantidad: linea.cantidad,
        },
      });

      let movimiento: ResultadoMovimiento;
      try {
        movimiento = await this.existencia.descontarVenta({
          productoId: linea.productoId,
          cantidad: linea.cantidad,
          unificado: plan.unificado,
          almacenId: plan.origen.almacenId,
          contenedorId: plan.origen.contenedorId,
        });
      } catch (error) {
        // Un rechazo claro (sin stock, producto inexistente) no deja efecto
        // alguno; cualquier otro error sí puede ser ambiguo y queda anotado
        // como "iniciado" sin resultado.
        if (error instanceof HttpException) {
          await this.idem.registrarPaso(op, 'stock', 'fallido', {
            linea: linea.indice,
            datos: { codigoHttp: error.getStatus(), mensaje: error.message },
          });
        }
        throw error;
      }

      const resultado: ResultadoLinea = {
        stockFinal: movimiento.stockTotal,
        ubicaciones: movimiento.ubicaciones,
      };
      resultados.set(linea.indice, resultado);

      await this.idem.registrarPaso(op, 'stock', 'hecho', {
        linea: linea.indice,
        datos: {
          stockFinal: resultado.stockFinal,
          ubicaciones: resultado.ubicaciones,
        },
      });
    }

    return resultados;
  }

  /** Número correlativo del comprobante (V-000123), con un contador atómico. */
  private async siguienteComprobante(): Promise<string> {
    for (let intento = 0; intento < 3; intento++) {
      try {
        const contador = await this.contadorModel
          .findOneAndUpdate(
            { _id: CONTADOR_COMPROBANTE_POS },
            { $inc: { seq: 1 } },
            { upsert: true, returnDocument: 'after' },
          )
          .lean()
          .exec();

        if (contador) {
          return `V-${String(contador.seq).padStart(6, '0')}`;
        }
      } catch (error) {
        // Dos cajeros creando el contador a la vez: el segundo reintenta.
        if (!esClaveDuplicada(error)) throw error;
      }
    }

    throw new InternalServerErrorException(
      'No se pudo asignar el número de comprobante',
    );
  }

  private armarRespuesta(
    plan: PlanCheckout,
    comprobante: string,
    resultados: Map<number, ResultadoLinea>,
    clave: string,
  ): RespuestaCheckout {
    return {
      venta: {
        _id: plan.ventaId.toHexString(),
        comprobante,
        fecha: plan.fecha.toISOString(),
        ...(plan.clienteId
          ? {
              clienteId: plan.clienteId.toHexString(),
              clienteNombre: plan.clienteNombre,
            }
          : {}),
        items: plan.lineas.map((l) => ({
          productoId: l.productoId.toHexString(),
          codigo: l.codigo,
          nombre: l.nombre,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          descuentoPct: l.descuentoPct,
          subtotal: l.bruto,
          descuento: l.descuentoMonto,
          impuesto: l.impuesto,
          total: l.total,
          stockRestante: resultados.get(l.indice)?.stockFinal ?? 0,
        })),
        subtotal: plan.totales.subtotal,
        descuento: plan.totales.descuento,
        impuestoPorciento: plan.totales.impuestoPorciento,
        impuesto: plan.totales.impuesto,
        total: plan.totales.total,
      },
      pago: {
        _id: plan.pagoId.toHexString(),
        tipo: plan.pago.tipo,
        montoRecibido: plan.pago.montoRecibido,
        cambio: plan.pago.cambio,
        esCuentaCasa: plan.pago.esCuentaCasa,
      },
      cambio: plan.pago.cambio,
      comprobante,
      advertencias: plan.advertencias,
      idempotencia: { clave, estado: 'completada', repetida: false },
    };
  }

  private avisarStockBajo(
    plan: PlanCheckout,
    resultados: Map<number, ResultadoLinea>,
  ): void {
    for (const linea of plan.lineas) {
      const restante = resultados.get(linea.indice)?.stockFinal;

      if (
        restante !== undefined &&
        linea.stockMinimo !== undefined &&
        restante < linea.stockMinimo
      ) {
        this.logger.warn(
          `STOCK BAJO: ${linea.nombre} tiene ${restante} (mín: ${linea.stockMinimo})`,
        );
      }
    }
  }

  // ───────────────────────────── Confirmación ─────────────────────────────

  private async confirmarConReintentos(
    op: ManejadorOperacion,
    plan: PlanCheckout,
    comprobante: string,
    resultados: Map<number, ResultadoLinea>,
    respuesta: RespuestaCheckout,
  ): Promise<void> {
    let ultimoError: unknown;

    for (let intento = 0; intento < this.reintentosConfirmacion; intento++) {
      try {
        await this.confirmar(op, plan, comprobante, resultados, respuesta);
        return;
      } catch (error) {
        if (error instanceof OperacionPerdidaError) throw error;
        ultimoError = error;
        this.logger.warn(
          `Confirmación del checkout ${op.clave} fallida (intento ${intento + 1}/${this.reintentosConfirmacion}): ${String(error)}`,
        );
        await dormir(this.pausaReintentoMs);
      }
    }

    throw ultimoError;
  }

  /**
   * Crea pago, venta, asientos de Kardex y filas de Reporte Plus, todos con el
   * `_id` fijado en el plan, y marca la operación como completada. Se puede
   * repetir cuantas veces haga falta: lo que ya existe no se duplica. Es lo
   * que usa la recuperación para terminar una venta que se cayó a medias.
   */
  async confirmar(
    op: ManejadorOperacion,
    plan: PlanCheckout,
    comprobante: string,
    resultados: Map<number, ResultadoLinea>,
    respuesta: RespuestaCheckout,
  ): Promise<void> {
    // Pago.
    await this.pagos.guardarPagoCheckout(plan.pagoId, plan.pago, plan.fecha);

    // Venta. Se arma aparte porque `createdAt`/`updatedAt` los pone el
    // esquema (timestamps) y aquí se fijan para que un reintento no cambie la fecha.
    const documentoVenta = {
      _id: plan.ventaId,
      comprobante,
      clienteId: plan.clienteId,
      clienteNombre: plan.clienteNombre,
      usuario: plan.usuario.nombre,
      operacion: op.clave,
      subtotal_venta: plan.totales.subtotal,
      descuento_total: plan.totales.descuento,
      impuesto: plan.totales.impuesto,
      impuestoPorciento: plan.totales.impuestoPorciento,
      total: plan.totales.total,
      pago: plan.pagoId,
      productos: plan.lineas.map((l) => {
        const ubicaciones = resultados.get(l.indice)?.ubicaciones ?? [];
        return {
          productoId: l.productoId,
          cantidad: l.cantidad,
          descuentoMonto: l.descuentoMonto,
          codigo: l.codigo,
          nombre: l.nombre,
          precioUnitario: l.precioUnitario,
          descuentoPct: l.descuentoPct,
          subtotal: l.bruto,
          impuesto: l.impuesto,
          total: l.total,
          ...(ubicaciones.length ? { ubicaciones } : {}),
        };
      }),
      createdAt: plan.fecha,
      updatedAt: plan.fecha,
    };

    try {
      await this.ventaModel.create(documentoVenta);
    } catch (error) {
      if (!esClaveDuplicada(error)) throw error;
    }

    // Kardex: el movimiento queda registrado en el momento de la venta (ya no
    // espera al cierre del turno).
    await insertarIgnorandoDuplicados(
      this.kardexModel,
      plan.lineas.map((l) => ({
        _id: l.kardexId,
        fecha: plan.fecha,
        productoId: l.productoId,
        tipo: KardexTipo.VENTA,
        cantidad: l.cantidad,
        stock: Math.max(0, resultados.get(l.indice)?.stockFinal ?? 0),
        motivo: `Venta (${plan.pago.tipo}) ${comprobante}`,
        referencia: comprobante,
        createdAt: plan.fecha,
        updatedAt: plan.fecha,
      })),
    );

    // Reporte Plus, con `enKardex: true` para que el cierre de turno no lo duplique.
    const metodoPago = {
      efectivo: MetodoPagoReporte.EFECTIVO,
      credito: MetodoPagoReporte.CREDITO,
      transferencia: MetodoPagoReporte.TRANSFERENCIA,
    }[plan.pago.tipo];
    // Cuenta casa: se entrega mercancía sin cobrar, el total cobrado es 0.
    const cobrado = plan.pago.esCuentaCasa ? 0 : 1;

    await this.reportePlus.registrarLineasRepetible(
      plan.lineas.map((l) => ({
        id: l.reporteId.toHexString(),
        productoId: l.productoId.toHexString(),
        codigo: l.codigo,
        nombre: l.nombre,
        cantidadVendida: l.cantidad,
        stockFinal: Math.max(0, resultados.get(l.indice)?.stockFinal ?? 0),
        metodoPago,
        total: redondear(l.total * cobrado),
        descuento: l.descuentoMonto,
        impuesto: l.impuesto,
        origen: OrigenReporte.VENTA,
        referencia: plan.ventaId.toHexString(),
        enKardex: true,
        fecha: plan.fecha,
      })),
    );

    await this.idem.completar(
      op,
      sinIndefinidos(respuesta) as unknown as Record<string, unknown>,
    );
  }

  // ───────────────────────────── Fallos y reversa ─────────────────────────────

  /**
   * Decide qué hacer con un fallo. Siempre lanza:
   *  - ya pasó el punto de no retorno: NO se revierte; la venta se completará
   *    en la recuperación y el reintento con la misma clave verá el resultado;
   *  - antes: se devuelve el stock reservado y la operación queda `fallida`
   *    (reintentable) o, si algo es dudoso, en `revision`.
   */
  private async manejarFallo(
    op: ManejadorOperacion,
    error: unknown,
  ): Promise<never> {
    if (error instanceof OperacionPerdidaError) {
      throw new ConflictException(
        cuerpoError(
          409,
          'Conflict',
          'La operación fue tomada por la recuperación del servidor. Reintente con la misma clave en unos segundos.',
          'OPERACION_TOMADA',
        ),
      );
    }

    let operacion: OperacionLean | null;
    try {
      operacion = await this.idem.leer(op.clave);
    } catch (lecturaError) {
      this.logger.error(
        `Checkout ${op.clave}: no se pudo leer el registro tras el fallo; lo terminará la recuperación: ${String(lecturaError)}`,
      );
      throw error;
    }

    if (operacion?.confirmando) {
      this.logger.error(
        `Checkout ${op.clave}: falló un paso de la confirmación; la venta se completará en la recuperación: ${String(error)}`,
      );
      throw new ServiceUnavailableException(
        cuerpoError(
          503,
          'Service Unavailable',
          'La venta ya está confirmada pero faltan pasos por registrar; se completará sola. Reintente con la misma clave en unos segundos.',
          'VENTA_PENDIENTE',
        ),
      );
    }

    let reversa: ResultadoReversa;
    try {
      reversa = operacion
        ? await this.revertir(op, operacion)
        : { devueltas: 0, ambiguas: [], fallidas: [], detalle: [] };
    } catch (reversaError) {
      this.logger.error(
        `Checkout ${op.clave}: no se pudo revertir tras el fallo; lo terminará la recuperación: ${String(reversaError)}`,
      );
      throw error;
    }

    if (reversa.ambiguas.length > 0 || reversa.fallidas.length > 0) {
      const motivo = `Venta interrumpida con stock dudoso: ${reversa.detalle.join('; ')}. Causa: ${String(error)}`;
      try {
        await this.idem.enviarARevision(op, motivo);
      } catch (revisionError) {
        this.logger.error(
          `Checkout ${op.clave}: no se pudo pasar a revisión: ${String(revisionError)}`,
        );
      }

      throw new InternalServerErrorException(
        cuerpoError(
          500,
          'Internal Server Error',
          `La venta no se pudo completar y quedó en revisión: el stock de algún producto podría no haberse devuelto. Avise al administrador (operación ${op.clave}).`,
          'OPERACION_EN_REVISION',
        ),
      );
    }

    const { codigoHttp, cuerpo } = this.describirError(error);
    try {
      await this.idem.fallar(op, codigoHttp, cuerpo);
    } catch (falloError) {
      this.logger.error(
        `Checkout ${op.clave}: se revirtió todo pero no se pudo marcar como fallida (la recuperación lo hará): ${String(falloError)}`,
      );
    }

    throw error;
  }

  private describirError(error: unknown): {
    codigoHttp: number;
    cuerpo: unknown;
  } {
    if (error instanceof HttpException) {
      return { codigoHttp: error.getStatus(), cuerpo: error.getResponse() };
    }

    return {
      codigoHttp: 500,
      cuerpo: cuerpoError(
        500,
        'Internal Server Error',
        'Error interno al procesar la venta. No se registró nada; puede reintentar con la misma clave.',
        'ERROR_INTERNO',
      ),
    };
  }

  /**
   * Devuelve el stock de las líneas que quedaron descontadas en esta ejecución
   * (las anotadas como `hecho`). Antes de devolver anota "revirtiendo" y al
   * terminar "revertido": así una caída a mitad nunca hace que la recuperación
   * devuelva dos veces lo mismo. Las líneas con un asiento "antes de escribir"
   * sin resultado son dudosas y NO se tocan.
   */
  async revertir(
    op: ManejadorOperacion,
    operacion: OperacionLean,
  ): Promise<ResultadoReversa> {
    const reversa: ResultadoReversa = {
      devueltas: 0,
      ambiguas: [],
      fallidas: [],
      detalle: [],
    };
    const plan = leerPlan(operacion.plan);
    if (!plan) return reversa;

    const estados = estadoDeStock(operacion.pasos, op.intento);

    for (const linea of plan.lineas) {
      const estado = estados.get(linea.indice);
      if (!estado) continue;

      const descripcion = `línea ${linea.indice + 1} (${linea.nombre} x${linea.cantidad})`;

      if (estado.evento === 'iniciado' || estado.evento === 'revirtiendo') {
        reversa.ambiguas.push(linea.indice);
        reversa.detalle.push(
          `${descripcion}: no se sabe si el stock ${estado.evento === 'iniciado' ? 'se descontó' : 'se devolvió'}`,
        );
        continue;
      }

      if (estado.evento !== 'hecho') continue;

      try {
        await this.idem.registrarPaso(op, 'stock', 'revirtiendo', {
          linea: linea.indice,
        });
        await this.existencia.reponerVenta({
          productoId: linea.productoId,
          cantidad: linea.cantidad,
          ubicaciones: estado.resultado?.ubicaciones,
        });
        await this.idem.registrarPaso(op, 'stock', 'revertido', {
          linea: linea.indice,
        });
        reversa.devueltas += 1;
      } catch (error) {
        if (error instanceof OperacionPerdidaError) throw error;
        this.logger.error(
          `Checkout ${op.clave}: no se pudo devolver el stock de la ${descripcion}: ${String(error)}`,
        );
        reversa.fallidas.push(linea.indice);
        reversa.detalle.push(`${descripcion}: no se pudo devolver el stock`);
      }
    }

    return reversa;
  }
}
