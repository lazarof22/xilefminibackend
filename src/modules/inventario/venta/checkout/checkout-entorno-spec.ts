/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
/**
 * Entorno de prueba del checkout (Fase 2): una "base de datos" en memoria con
 * todas las colecciones que toca una venta y los servicios REALES cableados
 * como en producción (ExistenciaService, PagoService, ReportePlusService,
 * OperacionIdempotenteService, CheckoutService, CheckoutRecuperacionService).
 *
 * Todos los modelos comparten un `interruptor`: con `interruptor.caido = true`
 * el "proceso" deja de existir (toda operación lanza). `reiniciar()` levanta
 * servicios nuevos sobre la MISMA base, que es lo que pasa cuando el servidor
 * se cae y vuelve a arrancar: así se prueba la recuperación en cada paso.
 *
 * Termina en `-spec.ts` para que `tsconfig.build.json` no lo compile en `dist`
 * y jest no lo ejecute como prueba.
 */
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { CLAVE_CONFIG_INVENTARIO } from '../../exitencia/schema/configuracion-inventario.schema';
import { ExistenciaService } from '../../exitencia/existencia.service';
import { Doc, FakeModel, Interruptor } from '../../exitencia/fake-mongo-spec';
import { PagoService } from '../../pago/pago.service';
import { ReportePlusService } from '../../reporte_plus/reporte_plus.service';
import { ConfiguracionTributariaService } from '../../../configuracion-tributaria/configuracion-tributaria.service';
import { CLAVE_CONFIG_VENTAS } from '../../../configuracion-tributaria/schema/configuracion-tributaria.schema';
import { OperacionIdempotenteService } from '../../../operacion-idempotente/operacion-idempotente.service';
import type { JwtUser } from '../../../auth/types/jwt-user.type';
import type { CreateCheckoutDto } from '../dto/create-checkout.dto';
import { CheckoutRecuperacionService } from './checkout-recuperacion.service';
import { CheckoutService } from './checkout.service';

export interface ProductoSemilla {
  codigo: string;
  nombre: string;
  precio: number;
  /** Stock total del producto (`stock_inicial`). */
  stock: number;
  stockMinimo?: number;
  /**
   * Reparto del stock en ubicaciones (solo modo unificado). Por defecto todo
   * el stock en el Estante 1. La suma debería coincidir con `stock`.
   */
  filas?: { contenedor: 1 | 2 | 3; cantidad: number }[];
}

export interface OpcionesEntorno {
  /** Modo de inventario por ubicación (Fase 1) encendido. */
  unificado?: boolean;
  /** Impuesto sobre ventas en % (si se omite, no hay configuración y vale 0). */
  impuesto?: number;
  productos?: ProductoSemilla[];
  /** Datos antiguos: ids de ubicación guardados como TEXTO en productos y existencias. */
  idsComoTexto?: boolean;
}

export const PRODUCTOS_BASE: ProductoSemilla[] = [
  { codigo: 'ARR-1', nombre: 'Arroz', precio: 100, stock: 10, stockMinimo: 2 },
  { codigo: 'FRI-1', nombre: 'Frijol', precio: 50, stock: 20, stockMinimo: 5 },
  { codigo: 'ACE-1', nombre: 'Aceite', precio: 33.33, stock: 6 },
];

/** Sin esperas reales: las pruebas no deben tardar. */
export function acelerar(
  idem: OperacionIdempotenteService,
  checkout: CheckoutService,
): void {
  idem.esperaMaxMs = 400;
  idem.intervaloMs = 5;
  checkout.pausaReintentoMs = 1;
}

export function crearEntorno(opciones: OpcionesEntorno = {}) {
  const interruptor: Interruptor = { caido: false };
  const nuevo = (docs: Record<string, any>[] = [], extra = {}) =>
    new FakeModel(docs, { ...extra, interruptor });

  const texto = (id: unknown) => (opciones.idsComoTexto ? String(id) : id);

  // ── Ubicaciones y productos ──
  const almacenes = nuevo([
    { nombreAlmacen: 'Central' },
    { nombreAlmacen: 'Tienda' },
  ]);
  const [A1, A2] = almacenes.docs.map((d) => d._id as Types.ObjectId);

  const contenedores = nuevo([
    { nombreContenedor: 'Estante 1', almacen: texto(A1) },
    { nombreContenedor: 'Estante 2', almacen: texto(A1) },
    { nombreContenedor: 'Vitrina', almacen: texto(A2) },
  ]);
  const [C1, C2, C3] = contenedores.docs.map((d) => d._id as Types.ObjectId);
  const contenedorDe = { 1: C1, 2: C2, 3: C3 } as const;
  const almacenDe = { 1: A1, 2: A1, 3: A2 } as const;

  const semillas = opciones.productos ?? PRODUCTOS_BASE;
  const productos = nuevo(
    semillas.map((s) => ({
      codigo_producto: s.codigo,
      nombre_producto: s.nombre,
      precio_venta: s.precio,
      stock_inicial: s.stock,
      ...(s.stockMinimo !== undefined ? { stock_minimo: s.stockMinimo } : {}),
      almacen: texto(A1),
      contenedor: texto(C1),
    })),
  );
  const P = productos.docs.map((d) => d._id as Types.ObjectId);

  // Índice único como el de la colección real: un id de texto y el mismo id
  // como ObjectId son valores distintos y conviven.
  const existencias = nuevo([], {
    unico: ['producto', 'almacen', 'contenedor'],
  });
  if (opciones.unificado) {
    semillas.forEach((s, i) => {
      const filas = s.filas ?? [{ contenedor: 1, cantidad: s.stock }];
      for (const fila of filas) {
        existencias.insertar({
          producto: opciones.idsComoTexto ? String(P[i]) : P[i],
          almacen: texto(almacenDe[fila.contenedor]),
          contenedor: texto(contenedorDe[fila.contenedor]),
          cantidad: fila.cantidad,
        });
      }
    });
  }

  const config = nuevo(
    opciones.unificado
      ? [{ clave: CLAVE_CONFIG_INVENTARIO, existenciasUnificadas: true }]
      : [],
  );
  const tributaria = nuevo(
    opciones.impuesto !== undefined
      ? [
          {
            clave: CLAVE_CONFIG_VENTAS,
            impuestoVentasPorciento: opciones.impuesto,
          },
        ]
      : [],
  );

  // ── Colecciones que escribe el checkout ──
  const clientes = nuevo([
    {
      id_cliente: '1',
      nombre_cliente: 'Juan Pérez',
      tipo_cliente: 'cliente_estandar',
    },
  ]);
  const ventas = nuevo();
  const kardex = nuevo();
  const contadores = nuevo();
  const reportes = nuevo();
  const turnos = nuevo();
  const extracciones = nuevo();
  const pagoBase = nuevo();
  const pagoEfectivo = nuevo();
  const pagoCredito = nuevo();
  const pagoTransferencia = nuevo();
  const operaciones = nuevo([], { unico: ['clave'] });

  const modelos = {
    almacenes,
    contenedores,
    productos,
    existencias,
    config,
    tributaria,
    clientes,
    ventas,
    kardex,
    contadores,
    reportes,
    pagoEfectivo,
    pagoCredito,
    pagoTransferencia,
    operaciones,
  };

  /** Servicios nuevos sobre la misma base (un "proceso" nuevo). */
  function crearServicios() {
    const existencia = new ExistenciaService(
      existencias as never,
      productos as never,
      almacenes as never,
      contenedores as never,
      config as never,
    );
    const pagos = new PagoService(
      pagoBase as never,
      pagoEfectivo as never,
      pagoCredito as never,
      pagoTransferencia as never,
      clientes as never,
      ventas as never,
    );
    const reporte = new ReportePlusService(
      reportes as never,
      turnos as never,
      kardex as never,
      extracciones as never,
    );
    const idem = new OperacionIdempotenteService(operaciones as never);
    const trib = new ConfiguracionTributariaService(tributaria as never);
    const checkout = new CheckoutService(
      ventas as never,
      clientes as never,
      productos as never,
      kardex as never,
      contadores as never,
      idem,
      existencia,
      pagos,
      reporte,
      trib,
    );
    acelerar(idem, checkout);
    const recuperacion = new CheckoutRecuperacionService(idem, checkout);

    return { existencia, pagos, reporte, idem, trib, checkout, recuperacion };
  }

  let servicios = crearServicios();

  return {
    interruptor,
    modelos,
    A1,
    A2,
    C1,
    C2,
    C3,
    P,
    get servicios() {
      return servicios;
    },
    get checkout() {
      return servicios.checkout;
    },
    get recuperacion() {
      return servicios.recuperacion;
    },
    get idem() {
      return servicios.idem;
    },

    /** Simula que el servidor volvió a arrancar: servicios nuevos, base intacta. */
    reiniciar() {
      interruptor.caido = false;
      servicios = crearServicios();
      return servicios;
    },

    /** Como si hubiera pasado el arrendamiento: la recuperación puede tomar lo que quedó en proceso. */
    vencerOperaciones() {
      for (const doc of operaciones.docs) {
        if (doc.estado === 'en_proceso')
          doc.vence = new Date(Date.now() - 1000);
      }
    },

    usuario(rol = 'cajero', nombre = 'cajero1'): JwtUser {
      return {
        userId: '64b000000000000000000001',
        nombre,
        rol,
        modulos: ['punto_venta'],
      };
    },

    // ── Lecturas para las comprobaciones ──
    stock: (i: number): number => Number(productos.porId(P[i])?.stock_inicial),
    /** Σ de las existencias por ubicación del producto `i`. */
    sumaExistencias: (i: number): number =>
      existencias.docs
        .filter((d) => String(d.producto) === String(P[i]))
        .reduce((s, d) => s + Number(d.cantidad), 0),
    cantidadEn: (i: number, contenedor: 1 | 2 | 3): number | undefined => {
      const fila = existencias.docs.find(
        (d) =>
          String(d.producto) === String(P[i]) &&
          String(d.contenedor) === String(contenedorDe[contenedor]),
      );
      return fila ? Number(fila.cantidad) : undefined;
    },
    operacion: (clave: string): Doc => {
      const op = operaciones.docs.find((d) => d.clave === clave);
      if (!op) throw new Error(`No hay operación con la clave ${clave}`);
      return op;
    },
    /** Eventos del registro de pasos de una operación, p. ej. `stock:iniciado#0`. */
    pasos: (clave: string): string[] =>
      (operaciones.docs.find((d) => d.clave === clave)?.pasos ?? []).map(
        (p: any) =>
          `${p.paso}:${p.evento}${p.linea !== undefined ? `#${p.linea}` : ''}`,
      ),
  };
}

export type Entorno = ReturnType<typeof crearEntorno>;

let contador = 0;
/** Una clave de idempotencia válida y distinta cada vez. */
export const claveNueva = (prefijo = 'clave'): string =>
  `${prefijo}-${String(++contador).padStart(6, '0')}-${Math.random().toString(36).slice(2, 10)}`;

/** Pago en efectivo con el desglose indicado (cantidades por denominación). */
export const efectivo = (
  desglose: Record<string, number>,
  extra: Record<string, unknown> = {},
) => ({ tipo: 'efectivo' as const, desglose, ...extra });

export function dtoCheckout(
  e: Entorno,
  items: { i: number; cantidad: number; descuentoPct?: number }[],
  pago: Record<string, unknown> = efectivo({ billete1000: 10 }),
  extra: Record<string, unknown> = {},
): CreateCheckoutDto {
  return {
    items: items.map((it) => ({
      productoId: String(e.P[it.i]),
      cantidad: it.cantidad,
      ...(it.descuentoPct !== undefined
        ? { descuentoPct: it.descuentoPct }
        : {}),
    })),
    pago,
    ...extra,
  } as unknown as CreateCheckoutDto;
}

/** Silencia los registros del Logger (los errores esperados ensucian la salida). */
export function silenciarLogs(): () => void {
  const espias = [
    jest.spyOn(Logger.prototype, 'error').mockImplementation(),
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
    jest.spyOn(Logger.prototype, 'log').mockImplementation(),
  ];
  return () => espias.forEach((s) => s.mockRestore());
}
