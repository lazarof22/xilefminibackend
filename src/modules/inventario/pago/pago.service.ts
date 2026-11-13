import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreatePagoCreditoDto,
  CreatePagoEfectivoDto,
  CreatePagoTransferenciaDto,
  DesgloseBilletesDto,
} from './dto/create-pago.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Pago } from './schema/pago.schema';
import { PagoCredito } from './schema/pago_credito.schema';
import {
  CODIGO_PAIS_POR_DEFECTO,
  PATRON_CI,
  PATRON_NIT,
  type TipoIdentidad,
} from '../../../common/utils/identidad';
import { PagoTransferencia } from './schema/pago_transferencia.schema';
import { Cliente } from '../../clientes y provedores/cliente/schemas/cliente.schema';
import { PagoEfectivo, TipoCliente } from './schema/pago_efectivo.schema';
import { Venta } from '../venta/schema/venta.schema';
import {
  DENOMINACIONES_CUP,
  PagoCheckoutDto,
  TipoPagoCheckout,
} from './dto/pago-checkout.dto';
import { redondear } from '../../factura/factura-totales';
import { esClaveDuplicada } from '../../../common/utils/insertar-idempotente';
import {
  buscarCanal,
  CANAL_PAGO_POR_DEFECTO,
} from '../../nomencladores/canal-pago/canal-pago.catalogo';
import { BancoService } from '../../nomencladores/banco/banco.service';
import type { BancoResuelto } from '../../nomencladores/banco/banco.service';
import { soloDigitos } from '../../nomencladores/banco/prefijo-tarjeta';
import {
  aCodigoMoneda,
  convertirCambio,
  MONEDA_BASE,
  montoEnMoneda,
  validarDesglose,
} from './divisas';
import type { TasaUsada } from './divisas';
import { MonedaPagoService } from './moneda-pago.service';
import type { MonedaCobro } from './moneda-pago.service';
import type { TipoTasa } from '../../configuracion-pagos/schema/configuracion-pagos.schema';

/** Pago ya validado contra el total del servidor, listo para guardarse. */
export interface PagoCheckoutPreparado {
  tipo: TipoPagoCheckout;
  /** Campos del documento de pago (sin `_id` ni fechas). */
  documento: Record<string, unknown>;
  /** Efectivo recibido (suma del desglose), en `moneda`; 0 si no es efectivo. */
  montoRecibido: number;
  /** Cambio, en `moneda`. */
  cambio: number;
  esCuentaCasa: boolean;

  // Fase 3. Opcionales: un plan guardado por la Fase 2 no los trae y sigue siendo válido.
  /** Moneda en la que paga el cliente (CUP, USD...). */
  moneda?: string;
  /** Lo que había que cobrar, expresado en `moneda`. */
  montoAPagarMoneda?: number;
  /** Moneda en la que se devuelve el cambio. */
  monedaCambio?: string;
  /** El cambio expresado en `monedaCambio` (solo si difiere de `moneda`). */
  cambioConvertido?: number;
  /** Desglose validado, valor → cantidad (solo efectivo con denominaciones). */
  desgloseValidado?: Record<string, number>;
  tasaUsada?: TasaUsada;
  /** Avisos que no bloquean el cobro (por ejemplo, el prefijo de la tarjeta). */
  advertencias?: string[];
}

/** Lo que el cobro necesita saber del cliente de la venta. */
export interface ClienteDelPago {
  _id: Types.ObjectId;
  tipoIdentidad?: string;
  id_cliente?: string;
  nit?: string;
  telefono_cliente?: string;
  codigoPais?: string;
}

/** Error 400 con el cuerpo del checkout: mensaje y `codigo` estable para la pantalla. */
const rechazo = (mensaje: string, codigo: string): BadRequestException =>
  new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: mensaje,
    codigo,
  });

const formato = (n: number, moneda: string): string =>
  `${n.toFixed(2)}${moneda === MONEDA_BASE ? '' : ` ${moneda}`}`;

@Injectable()
export class PagoService {
  constructor(
    @InjectModel(Pago.name) private pagoModel: Model<Pago>,
    @InjectModel(PagoEfectivo.name)
    private pagoEfectivoModel: Model<PagoEfectivo>,
    @InjectModel(PagoCredito.name) private pagoCreditoModel: Model<PagoCredito>,
    @InjectModel(PagoTransferencia.name)
    private pagoTransferenciaModel: Model<PagoTransferencia>,
    @InjectModel(Cliente.name) private clienteModel: Model<Cliente>,
    @InjectModel(Venta.name) private ventaModel: Model<Venta>,
    private readonly monedas: MonedaPagoService,
    private readonly bancos: BancoService,
  ) {}

  //Pago en transferencia.
  async createPagoT(
    createPagoTransferenciaDto: CreatePagoTransferenciaDto,
  ): Promise<PagoTransferencia> {
    const {
      montoPagar,
      monto_pagado,
      numeroCuenta,
      referenciaPago,
      banco,
      notas,
      ciCliente,
      nombreCliente,
      clienteId,
    } = createPagoTransferenciaDto;

    const nuevoPagoTransferencia = new this.pagoTransferenciaModel({
      montoPagar: montoPagar ?? monto_pagado,
      numeroCuenta: numeroCuenta ?? referenciaPago,
      banco,
      notas,
      ciCliente,
      nombreCliente,
      clienteId: clienteId || undefined,
      metodoPago: 'transferencia',
    });

    return nuevoPagoTransferencia.save();
  }

  //Pago en credito
  async createPagoC(
    createPagoCreditoDto: CreatePagoCreditoDto,
  ): Promise<PagoCredito> {
    const { monto_pagar, clienteId } = createPagoCreditoDto;
    if (!clienteId) {
      throw new BadRequestException(
        'El cliente es obligatorio para pagos a crédito',
      );
    }
    const cliente = await this.clienteModel.findById(clienteId);
    if (!cliente) {
      throw new NotFoundException('No se encontró el cliente');
    }

    const nuevoPagoCredito = new this.pagoCreditoModel({
      clienteId: cliente._id,
      monto_pagar,
      metodoPago: 'credito',
    });

    return nuevoPagoCredito.save();
  }

  //Pago en efectivo
  // ✅ Pago en efectivo - ACTUALIZADO (compatible con el contrato del Punto de Venta)
  async createPagoE(
    createPagoEfectivoDto: CreatePagoEfectivoDto,
  ): Promise<PagoEfectivo> {
    const {
      desglose,
      monto_pagado,
      monto_pagar,
      monto_pagar_CUP,
      monto_pagar_alCambio,
      cambio,
      cliente,
      moneda,
      datosClienteDescuento,
    } = createPagoEfectivoDto;

    // ─── Validación especial: Cliente Cuenta Casa ───
    const esCuentaCasa = cliente === TipoCliente.CLIENTECUENTACASA;

    if (esCuentaCasa) {
      if (monto_pagado !== undefined && monto_pagado !== 0) {
        throw new BadRequestException(
          'Para cliente cuenta casa el monto pagado debe ser 0',
        );
      }
    } else {
      // ─── Para los demás clientes, el desglose es obligatorio (se valida abajo) ───
    }

    // ─── Validación especial: Cliente por Descuento ───
    if (cliente === TipoCliente.CLIENTEPORDESCUENTO) {
      if (!datosClienteDescuento) {
        throw new BadRequestException(
          'Los datos del cliente (nombre, CI, teléfono) son obligatorios para clientes por descuento',
        );
      }
      const { nombre, ci, telefono } = datosClienteDescuento;
      if (!nombre || !ci || !telefono) {
        throw new BadRequestException(
          'Nombre, CI y Teléfono son obligatorios para clientes por descuento',
        );
      }
    }

    // ─── Validación del desglose y el cambio (solo si NO es cuenta casa) ───
    let totalDesglose = 0;
    if (!esCuentaCasa) {
      if (!desglose) {
        throw new BadRequestException(
          'El desglose es obligatorio para pagos en efectivo',
        );
      }
      totalDesglose = this.calcularTotalDesglose(desglose);

      const montoPagado = monto_pagado ?? totalDesglose;
      const montoPagar = monto_pagar ?? monto_pagar_CUP ?? 0;

      if (totalDesglose < montoPagado) {
        throw new BadRequestException(
          `El desglose no suma el monto pagado. Se necesita ${montoPagado}, pero el desglose suma ${totalDesglose}`,
        );
      }

      if (montoPagado < montoPagar) {
        throw new BadRequestException(
          `El monto pagado es menor que el monto a pagar. Pagado: ${montoPagado}, a pagar: ${montoPagar}`,
        );
      }

      const cambioEsperado = montoPagado - montoPagar;
      if (cambio !== cambioEsperado) {
        throw new BadRequestException(
          `El cambio es incorrecto. Se esperaba ${cambioEsperado}, pero se proporcionó ${cambio}`,
        );
      }

      // ─── Crear el documento ───
      const nuevoPagoEfectivo = new this.pagoEfectivoModel({
        monto_pagado: montoPagado,
        desglose,
        monto_pagar_CUP: monto_pagar_CUP ?? monto_pagar ?? 0,
        monto_pagar_alCambio: monto_pagar_alCambio ?? 0,
        cambio,
        cliente: cliente ?? TipoCliente.CLIENTEESTANDAR,
        moneda: moneda || undefined,
        esCuentaCasa: false,
        datosClienteDescuento:
          cliente === TipoCliente.CLIENTEPORDESCUENTO
            ? datosClienteDescuento
            : undefined,
        metodoPago: 'efectivo',
      });

      return nuevoPagoEfectivo.save();
    }

    // ─── Caso cuenta casa: monto pagado 0, sin desglose ───
    const nuevoPagoCuentaCasa = new this.pagoEfectivoModel({
      monto_pagado: 0,
      desglose: undefined,
      monto_pagar_CUP: monto_pagar_CUP ?? monto_pagar ?? 0,
      monto_pagar_alCambio: monto_pagar_alCambio ?? 0,
      cambio: 0,
      cliente: TipoCliente.CLIENTECUENTACASA,
      moneda: moneda || undefined,
      esCuentaCasa: true,
      metodoPago: 'efectivo',
    });

    return nuevoPagoCuentaCasa.save();
  }

  private calcularTotalDesglose(desglose: DesgloseBilletesDto): number {
    return (
      (desglose.billete5000 || 0) * 5000 +
      (desglose.billete2000 || 0) * 2000 +
      (desglose.billete1000 || 0) * 1000 +
      (desglose.billete500 || 0) * 500 +
      (desglose.billete200 || 0) * 200 +
      (desglose.billete100 || 0) * 100 +
      (desglose.billete50 || 0) * 50 +
      (desglose.billete20 || 0) * 20 +
      (desglose.billete10 || 0) * 10 +
      (desglose.billete5 || 0) * 5 +
      (desglose.billete3 || 0) * 3 +
      (desglose.billete1 || 0) * 1
    );
  }

  private rangoDelDia(fecha?: string): { start: Date; end: Date } {
    const start = fecha ? new Date(fecha) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  async resumenEfectivoEstandar(fecha?: string) {
    const { start, end } = this.rangoDelDia(fecha);
    const pagos = await this.pagoEfectivoModel
      .find({
        createdAt: { $gte: start, $lte: end },
        esCuentaCasa: { $ne: true },
        cliente: { $ne: TipoCliente.CLIENTEPORDESCUENTO },
      })
      .lean()
      .exec();

    return {
      tipoCliente: 'Cliente por efectivo o estandar',
      cantidad: pagos.length,
      monto: pagos.reduce((sum, p) => sum + (p.monto_pagado || 0), 0),
    };
  }

  async resumenPorDescuento(fecha?: string) {
    const { start, end } = this.rangoDelDia(fecha);
    const pagos = await this.pagoEfectivoModel
      .find({
        createdAt: { $gte: start, $lte: end },
        esCuentaCasa: { $ne: true },
        cliente: TipoCliente.CLIENTEPORDESCUENTO,
      })
      .lean()
      .exec();

    const idsPagos = pagos.map((p) => p._id);
    const ventas =
      idsPagos.length > 0
        ? await this.ventaModel
            .find({ pago: { $in: idsPagos } })
            .lean()
            .exec()
        : [];

    return {
      tipoCliente: 'Cliente por descuento',
      cantidad: pagos.length,
      monto: ventas.reduce((sum, v) => sum + (v.descuento_total || 0), 0),
    };
  }

  async resumenPorTransferencia(fecha?: string) {
    const { start, end } = this.rangoDelDia(fecha);
    const pagos = await this.pagoTransferenciaModel
      .find({ createdAt: { $gte: start, $lte: end } })
      .lean()
      .exec();

    return {
      tipoCliente: 'Cliente por transferencia',
      cantidad: pagos.length,
      monto: pagos.reduce((sum, p) => sum + (p.montoPagar || 0), 0),
    };
  }

  async resumenCuentaCasa(fecha?: string) {
    const { start, end } = this.rangoDelDia(fecha);
    const pagos = await this.pagoEfectivoModel
      .find({
        createdAt: { $gte: start, $lte: end },
        esCuentaCasa: true,
      })
      .lean()
      .exec();

    return {
      tipoCliente: 'Cliente cuenta casa',
      cantidad: pagos.length,
      monto: pagos.reduce(
        (sum, p) => sum + (p.monto_pagar_CUP || p.monto_pagar_alCambio || 0),
        0,
      ),
    };
  }

  async resumenPorCredito(fecha?: string) {
    const { start, end } = this.rangoDelDia(fecha);
    const pagos = await this.pagoCreditoModel
      .find({ createdAt: { $gte: start, $lte: end } })
      .lean()
      .exec();

    return {
      tipoCliente: 'Cliente por credito',
      cantidad: pagos.length,
      monto: pagos.reduce((sum, p) => sum + (p.monto_pagar || 0), 0),
    };
  }

  // ───────────────────────── Checkout (Fases 2 y 3) ─────────────────────────

  /**
   * Monedas con las que se puede cobrar efectivo ahora mismo (con tasa vigente y
   * billetes configurados) y qué tasa se usa. Lo muestra el punto de venta.
   */
  monedasDeCobro(): Promise<{
    tipoTasa: TipoTasa;
    monedas: MonedaCobro[];
  }> {
    return this.monedas.monedasDeCobro();
  }

  /**
   * Valida el pago de un checkout contra el TOTAL CALCULADO POR EL SERVIDOR y
   * arma el documento. El cliente no manda montos: el efectivo recibido sale
   * de sumar el desglose y el cambio se calcula aquí. No escribe nada, así
   * que un pago inválido se rechaza antes de tocar el stock.
   */
  async prepararPagoCheckout(
    pago: PagoCheckoutDto,
    total: number,
    cliente?: ClienteDelPago,
  ): Promise<PagoCheckoutPreparado> {
    switch (pago.tipo) {
      case 'efectivo':
        return this.prepararEfectivoCheckout(pago, total);
      case 'credito':
        return this.prepararCreditoCheckout(pago, total, cliente);
      case 'transferencia':
        return this.prepararTransferenciaCheckout(pago, total, cliente);
      default:
        throw new BadRequestException('Tipo de pago no válido');
    }
  }

  private async prepararEfectivoCheckout(
    pago: PagoCheckoutDto,
    total: number,
  ): Promise<PagoCheckoutPreparado> {
    const tipoCliente = pago.tipoCliente ?? TipoCliente.CLIENTEESTANDAR;
    const desgloseNuevo = pago.desgloseDenominaciones;

    // Cuenta casa: se entrega la mercancía sin cobrar (el total queda registrado).
    if (tipoCliente === TipoCliente.CLIENTECUENTACASA) {
      const hayLegado = DENOMINACIONES_CUP.some(
        ([clave]) => (pago.desglose?.[clave] ?? 0) > 0,
      );
      const hayNuevo = Object.values(desgloseNuevo ?? {}).some(
        (cantidad) => Number(cantidad) > 0,
      );

      if (hayLegado || hayNuevo) {
        throw new BadRequestException(
          'Para cliente cuenta casa no se recibe efectivo: el desglose debe estar vacío',
        );
      }

      return {
        tipo: 'efectivo',
        montoRecibido: 0,
        cambio: 0,
        esCuentaCasa: true,
        documento: {
          monto_pagado: 0,
          monto_pagar_CUP: total,
          monto_pagar_alCambio: 0,
          cambio: 0,
          cliente: TipoCliente.CLIENTECUENTACASA,
          esCuentaCasa: true,
          metodoPago: 'efectivo',
        },
      };
    }

    if (tipoCliente === TipoCliente.CLIENTEPORDESCUENTO) {
      const datos = pago.datosClienteDescuento;
      if (!datos?.nombre || !datos.ci || !datos.telefono) {
        throw new BadRequestException(
          'Nombre, CI y Teléfono son obligatorios para clientes por descuento',
        );
      }
    }

    const moneda = aCodigoMoneda(pago.moneda) ?? MONEDA_BASE;
    const monedaCambio = aCodigoMoneda(pago.monedaCambio) ?? moneda;
    const conDivisas = moneda !== MONEDA_BASE || monedaCambio !== MONEDA_BASE;

    if (desgloseNuevo !== undefined && pago.desglose !== undefined) {
      throw rechazo(
        'Envíe un solo desglose: desgloseDenominaciones o el desglose anterior de CUP, no los dos',
        'DESGLOSE_NO_VALIDO',
      );
    }

    // Billetes y monedas recibidos, en `moneda`.
    let montoRecibido: number;
    let desgloseLegado: Record<string, number> | undefined;
    let desgloseValidado: Record<string, number> | undefined;

    if (desgloseNuevo !== undefined) {
      const permitidas = await this.monedas.denominacionesDe(moneda);
      const validado = validarDesglose(desgloseNuevo, moneda, permitidas);

      desgloseValidado = validado.desglose;
      montoRecibido = redondear(validado.total);

      // Los pagos en CUP conservan además el desglose anterior (billeteN),
      // que es el que ya leen los reportes.
      if (moneda === MONEDA_BASE) {
        const porValor = new Map<number, string>(
          DENOMINACIONES_CUP.map(([clave, valor]) => [valor, clave]),
        );
        desgloseLegado = Object.fromEntries(
          DENOMINACIONES_CUP.map(([clave]) => [clave, 0]),
        );
        for (const [valor, cantidad] of Object.entries(validado.desglose)) {
          const clave = porValor.get(Number(valor));
          if (clave) desgloseLegado[clave] = cantidad;
        }
      }
    } else {
      if (moneda !== MONEDA_BASE) {
        throw rechazo(
          `El desglose anterior solo sirve para CUP: para cobrar en ${moneda} envíe desgloseDenominaciones`,
          'DESGLOSE_NO_VALIDO',
        );
      }

      desgloseLegado = Object.fromEntries(
        DENOMINACIONES_CUP.map(([clave]) => [
          clave,
          pago.desglose?.[clave] ?? 0,
        ]),
      );
      montoRecibido = redondear(
        DENOMINACIONES_CUP.reduce(
          (suma, [clave, valor]) => suma + desgloseLegado![clave] * valor,
          0,
        ),
      );
    }

    if (montoRecibido <= 0) {
      throw new BadRequestException(
        'El desglose de billetes es obligatorio para pagos en efectivo',
      );
    }

    // Tasas: solo hacen falta si el cliente paga o recibe el cambio en otra moneda.
    let aPagar = total;
    let tasaUsada: TasaUsada | undefined;
    let tasaPago = 1;
    let tasaCambio = 1;

    if (conDivisas) {
      const tipo = await this.monedas.tipoTasa();
      const tPago = await this.monedas.tasaDe(moneda, tipo);
      const tCambio =
        monedaCambio === moneda
          ? tPago
          : await this.monedas.tasaDe(monedaCambio, tipo);

      tasaPago = tPago.cupPorUnidad;
      tasaCambio = tCambio.cupPorUnidad;
      aPagar = moneda === MONEDA_BASE ? total : montoEnMoneda(total, tasaPago);

      const fechas = [tPago.fecha, tCambio.fecha].filter(
        (f): f is Date => f instanceof Date,
      );
      tasaUsada = {
        tipo,
        monedaPago: moneda,
        tasaPago,
        monedaCambio,
        tasaCambio,
        ...(fechas.length
          ? {
              fecha: new Date(Math.max(...fechas.map((f) => f.getTime()))),
            }
          : {}),
      };
    }

    if (montoRecibido < aPagar) {
      throw rechazo(
        `El efectivo recibido (${formato(montoRecibido, moneda)}) es menor que el total de la venta (${formato(aPagar, moneda)})`,
        'MONTO_INSUFICIENTE',
      );
    }

    const cambio = redondear(montoRecibido - aPagar);
    // cambioConvertido = cambioA × tasaA ÷ tasaB (tasas en CUP por unidad).
    const cambioConvertido =
      monedaCambio !== moneda
        ? convertirCambio(cambio, tasaPago, tasaCambio)
        : undefined;
    const persistirMoneda = desgloseNuevo !== undefined || conDivisas;

    return {
      tipo: 'efectivo',
      montoRecibido,
      cambio,
      esCuentaCasa: false,
      ...(persistirMoneda ? { moneda } : {}),
      ...(conDivisas
        ? {
            montoAPagarMoneda: aPagar,
            monedaCambio,
            ...(cambioConvertido !== undefined ? { cambioConvertido } : {}),
            tasaUsada,
          }
        : {}),
      ...(desgloseValidado ? { desgloseValidado } : {}),
      documento: {
        monto_pagado: montoRecibido,
        desglose: desgloseLegado,
        ...(desgloseValidado
          ? {
              desgloseDenominaciones: Object.entries(desgloseValidado)
                .map(([valor, cantidad]) => ({
                  valor: Number(valor),
                  cantidad,
                }))
                .sort((a, b) => b.valor - a.valor),
            }
          : {}),
        monto_pagar_CUP: total,
        monto_pagar_alCambio: moneda === MONEDA_BASE ? 0 : aPagar,
        cambio,
        ...(persistirMoneda ? { moneda } : {}),
        ...(conDivisas
          ? {
              monedaCambio,
              ...(cambioConvertido !== undefined ? { cambioConvertido } : {}),
              tasaUsada,
            }
          : {}),
        cliente: tipoCliente,
        esCuentaCasa: false,
        datosClienteDescuento:
          tipoCliente === TipoCliente.CLIENTEPORDESCUENTO
            ? pago.datosClienteDescuento
            : undefined,
        metodoPago: 'efectivo',
      },
    };
  }

  /**
   * Crédito: exige un cliente identificado. La identidad (CI de 11 dígitos o
   * NIT) sale de lo que mande la pantalla y, si no manda nada, del cliente. El
   * teléfono y su prefijo de país se guardan en el pago como estaban en la venta.
   */
  private prepararCreditoCheckout(
    pago: PagoCheckoutDto,
    total: number,
    cliente?: ClienteDelPago,
  ): PagoCheckoutPreparado {
    if (!cliente) {
      throw new BadRequestException(
        'El cliente es obligatorio para ventas a crédito',
      );
    }

    const tipoIdentidad: TipoIdentidad =
      pago.tipoIdentidad ?? (cliente.tipoIdentidad === 'NIT' ? 'NIT' : 'CI');

    // Del cliente solo se toma el dato del mismo tipo: en un cliente NIT,
    // `id_cliente` guarda el NIT, no una CI.
    const delCliente =
      tipoIdentidad === 'NIT'
        ? (cliente.nit ??
          (cliente.tipoIdentidad === 'NIT' ? cliente.id_cliente : undefined))
        : cliente.tipoIdentidad === 'NIT'
          ? undefined
          : cliente.id_cliente;
    const identidad = (
      tipoIdentidad === 'NIT'
        ? (pago.nit ?? delCliente)
        : (pago.ci ?? delCliente)
    )?.trim();

    if (!identidad) {
      throw rechazo(
        tipoIdentidad === 'NIT'
          ? 'El NIT del cliente es obligatorio para ventas a crédito'
          : 'La CI del cliente es obligatoria para ventas a crédito',
        'IDENTIDAD_REQUERIDA',
      );
    }

    if (tipoIdentidad === 'CI' && !PATRON_CI.test(identidad)) {
      throw rechazo(
        `La CI debe tener exactamente 11 dígitos numéricos (se recibieron ${identidad.length} caracteres)`,
        'CI_INVALIDA',
      );
    }

    if (tipoIdentidad === 'NIT' && !PATRON_NIT.test(identidad)) {
      throw rechazo(
        'El NIT debe tener de 5 a 20 letras, números o guiones',
        'NIT_INVALIDO',
      );
    }

    const telefono = (pago.telefono ?? cliente.telefono_cliente)?.trim();
    const digitos = soloDigitos(pago.telefono ?? '');

    // Solo se exige un formato al teléfono que escribe el cajero; el del
    // registro del cliente se guarda como esté.
    if (
      pago.telefono !== undefined &&
      (digitos.length < 5 || digitos.length > 15)
    ) {
      throw rechazo(
        'El teléfono debe tener entre 5 y 15 dígitos',
        'TELEFONO_INVALIDO',
      );
    }

    return {
      tipo: 'credito',
      montoRecibido: 0,
      cambio: 0,
      esCuentaCasa: false,
      documento: {
        clienteId: cliente._id,
        monto_pagar: total,
        tipoIdentidad,
        ...(tipoIdentidad === 'CI' ? { ci: identidad } : { nit: identidad }),
        ...(telefono ? { telefono } : {}),
        codigoPais:
          pago.codigoPais ?? cliente.codigoPais ?? CODIGO_PAIS_POR_DEFECTO,
        metodoPago: 'credito',
      },
    };
  }

  private async prepararTransferenciaCheckout(
    pago: PagoCheckoutDto,
    total: number,
    cliente?: ClienteDelPago,
  ): Promise<PagoCheckoutPreparado> {
    const canal = pago.canal ?? CANAL_PAGO_POR_DEFECTO;
    const infoCanal = buscarCanal(canal);
    const referencia = pago.numeroCuenta || pago.referenciaPago;

    if (!referencia) {
      throw new BadRequestException(
        'El número de referencia de la transferencia es obligatorio',
      );
    }

    // Banco del nomenclador; el texto libre `banco` (como lo mandaba el
    // diálogo anterior) se acepta pero no se valida contra el nomenclador.
    const banco: BancoResuelto | undefined =
      pago.bancoId || pago.banco
        ? await this.bancos.resolver({
            bancoId: pago.bancoId,
            codigo: pago.banco,
          })
        : undefined;

    if (infoCanal?.requiereBanco && !banco && !pago.banco) {
      throw new BadRequestException(
        'El banco de la transferencia es obligatorio',
      );
    }

    // Avisos que no bloquean: el número de tarjeta no parece de ese banco.
    const advertencias: string[] = [];
    if (banco && pago.tipoCuenta === 'tarjeta') {
      const aviso = await this.bancos.advertenciaDeTarjeta(
        banco,
        pago.numeroCuenta || referencia,
      );
      if (aviso) advertencias.push(aviso);
    }

    // Moneda transferida: sin indicarla es la del canal (Zelle: USD).
    const moneda =
      aCodigoMoneda(pago.moneda) ?? infoCanal?.monedaPorDefecto ?? MONEDA_BASE;
    const conDivisas = moneda !== MONEDA_BASE;
    let montoMoneda = total;
    let tasaUsada: TasaUsada | undefined;

    if (conDivisas) {
      const tipo = await this.monedas.tipoTasa();
      const tasa = await this.monedas.tasaDe(moneda, tipo);

      montoMoneda = montoEnMoneda(total, tasa.cupPorUnidad);
      tasaUsada = {
        tipo,
        monedaPago: moneda,
        tasaPago: tasa.cupPorUnidad,
        ...(tasa.fecha ? { fecha: tasa.fecha } : {}),
      };
    }

    const persistirMoneda = conDivisas || pago.moneda !== undefined;

    return {
      tipo: 'transferencia',
      montoRecibido: 0,
      cambio: 0,
      esCuentaCasa: false,
      ...(persistirMoneda ? { moneda, montoAPagarMoneda: montoMoneda } : {}),
      ...(tasaUsada ? { tasaUsada } : {}),
      ...(advertencias.length ? { advertencias } : {}),
      documento: {
        montoPagar: total,
        numeroCuenta: referencia,
        referenciaPago: pago.referenciaPago ?? referencia,
        banco: banco?.codigo ?? pago.banco,
        bancoId: banco?._id,
        tipoCuenta: pago.tipoCuenta,
        canal,
        ...(persistirMoneda ? { moneda, montoMoneda } : {}),
        ...(tasaUsada ? { tasaUsada } : {}),
        notas: pago.notas,
        ciCliente: pago.ciCliente,
        nombreCliente: pago.nombreCliente,
        clienteId: cliente?._id,
        metodoPago: 'transferencia',
      },
    };
  }

  /**
   * Guarda el pago del checkout con el `_id` y la fecha de la operación. Es
   * repetible: si ya existe (la recuperación repite el paso tras una caída),
   * no hace nada.
   */
  async guardarPagoCheckout(
    id: Types.ObjectId,
    pago: PagoCheckoutPreparado,
    fecha: Date,
  ): Promise<void> {
    const modelo: Model<any> =
      pago.tipo === 'efectivo'
        ? this.pagoEfectivoModel
        : pago.tipo === 'credito'
          ? this.pagoCreditoModel
          : this.pagoTransferenciaModel;

    try {
      await modelo.create({
        _id: id,
        ...pago.documento,
        createdAt: fecha,
        updatedAt: fecha,
      });
    } catch (error) {
      if (!esClaveDuplicada(error)) throw error;
    }
  }

  async findAll(): Promise<Pago[]> {
    return this.pagoModel
      .find()
      .populate('clienteId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findOne(id: string): Promise<Pago> {
    const pago = await this.pagoModel.findById(id).populate('clienteId').exec();

    if (!pago) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado`);
    }

    return pago;
  }
}
