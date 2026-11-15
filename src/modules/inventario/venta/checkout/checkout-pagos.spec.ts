/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EstadoOperacion } from '../../../operacion-idempotente/schema/operacion-idempotente.schema';
import { Doc, FakeModel } from '../../exitencia/fake-mongo-spec';
import type { CreateCheckoutDto } from '../dto/create-checkout.dto';
import {
  CI_CLIENTE_BASE,
  claveNueva,
  crearEntorno,
  dtoCheckout,
  efectivo,
  Entorno,
  FECHA_TASAS_BASE,
  silenciarLogs,
} from './checkout-entorno-spec';
import { leerPlan } from './checkout.types';

/**
 * Pagos completos (Fase 3) de punta a punta: la venta entera contra una base
 * en memoria con los servicios reales. Lo que se comprueba es que el cobro en
 * otra moneda, el crédito con identidad y las transferencias por canal dejan
 * en la base lo que dice el diseño, que un rechazo no toca nada y que la tasa
 * usada sobrevive al reintento del cajero y a la caída del servidor.
 *
 * Catálogo (precio · stock): [0] Arroz 100 · 10   [1] Frijol 50 · 20.
 * Impuesto 10 %. Tasas del mercado informal: USD 400, EUR 450 (CUP por unidad);
 * del Banco Central: USD 120, EUR 130. Sin configurar, se usa la informal.
 *
 * La venta de casi todas las pruebas es Arroz ×4: 400 + 40 de impuesto = 440 CUP
 * (1,10 USD con la tasa informal).
 */

async function error(promesa: Promise<unknown>): Promise<HttpException> {
  try {
    await promesa;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('Se esperaba un error y no lo hubo');
}

const cuerpo = (e: HttpException): Record<string, unknown> =>
  e.getResponse() as Record<string, unknown>;

const vender = (e: Entorno, dto: CreateCheckoutDto, clave = claveNueva()) =>
  e.checkout.ejecutar(dto, clave, e.usuario());

/** Arroz ×4: 440 CUP con el impuesto del 10 %. */
const arroz4 = (
  e: Entorno,
  pago: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => dtoCheckout(e, [{ i: 0, cantidad: 4 }], pago, extra);

/** Efectivo en otra moneda con los billetes `{ "valor": cantidad }`. */
const enMoneda = (
  moneda: string,
  billetes: Record<string, number>,
  extra: Record<string, unknown> = {},
) => ({
  tipo: 'efectivo' as const,
  moneda,
  desgloseDenominaciones: billetes,
  ...extra,
});

const credito = (extra: Record<string, unknown> = {}) => ({
  tipo: 'credito' as const,
  ...extra,
});

const transferencia = (extra: Record<string, unknown> = {}) => ({
  tipo: 'transferencia' as const,
  ...extra,
});

const clienteBase = (e: Entorno): Doc => e.modelos.clientes.docs[0];
const conCliente = (e: Entorno): Record<string, unknown> => ({
  clienteId: String(clienteBase(e)._id),
});

/** Registra la nueva tasa del mercado informal de una moneda (la que ya había se modifica). */
function cambiarTasa(e: Entorno, moneda: string, informal: number): void {
  const tasa = e.modelos.tasas.docs.find((d) => d.moneda === moneda);
  if (!tasa) throw new Error(`No hay tasa de ${moneda}`);
  tasa.tasaMercadoInformal = informal;
}

function nadaCreado(e: Entorno): void {
  expect(e.modelos.ventas.docs).toHaveLength(0);
  expect(e.modelos.pagoEfectivo.docs).toHaveLength(0);
  expect(e.modelos.pagoCredito.docs).toHaveLength(0);
  expect(e.modelos.pagoTransferencia.docs).toHaveLength(0);
  expect(e.modelos.kardex.docs).toHaveLength(0);
  expect(e.modelos.reportes.docs).toHaveLength(0);
}

function stockIntacto(e: Entorno): void {
  expect(e.stock(0)).toBe(10);
  expect(e.stock(1)).toBe(20);
  expect(e.stock(2)).toBe(6);
}

/**
 * Una venta que el pago rechaza: 400 con su código estable, sin stock tocado,
 * sin nada creado y con la operación cerrada como fallida. Devuelve el cuerpo
 * del error para revisar el mensaje.
 */
async function rechazada(
  e: Entorno,
  dto: CreateCheckoutDto,
  codigo: string,
): Promise<Record<string, unknown>> {
  const clave = claveNueva();
  const fallo = await error(vender(e, dto, clave));

  expect(fallo.getStatus()).toBe(400);
  expect(cuerpo(fallo).codigo).toBe(codigo);
  stockIntacto(e);
  nadaCreado(e);
  expect(e.operacion(clave).estado).toBe(EstadoOperacion.FALLIDA);
  expect(e.operacion(clave).error.codigoHttp).toBe(400);

  return cuerpo(fallo);
}

// ───────────────────── Caídas del servidor (como en la Fase 2) ─────────────────────

type Cuando = (op: string, datos: Doc) => boolean;
const creacion: Cuando = (op) => op === 'create';

/** Deja caído el proceso en la primera escritura que cumpla `cuando`. */
function caerEn(
  e: Entorno,
  modelo: FakeModel,
  fase: 'antes' | 'despues',
  cuando: Cuando,
): void {
  let cuenta = 0;
  modelo.hooks[fase] = (op, datos) => {
    if (cuando(op, datos) && ++cuenta === 1) e.interruptor.caido = true;
  };
}

/** La venta cae justo al ir a crear el pago: ya estaba confirmada, la recuperación la termina. */
async function ventaQueSeCaeAntesDelPago(
  e: Entorno,
  pagos: FakeModel,
  dto: CreateCheckoutDto,
  clave: string,
): Promise<void> {
  caerEn(e, pagos, 'antes', creacion);

  await expect(vender(e, dto, clave)).rejects.toThrow(/Proceso caído/);
  expect(e.interruptor.caido).toBe(true);
  expect(pagos.docs).toHaveLength(0);
}

/** Reinicio del servidor + vence el arrendamiento + corre la recuperación. */
async function recuperar(e: Entorno) {
  for (const modelo of Object.values(e.modelos)) modelo.hooks = {};
  e.reiniciar();
  e.vencerOperaciones();
  return e.recuperacion.barrer();
}

describe('Pagos completos (Fase 3) — venta de punta a punta', () => {
  let restaurar: () => void;

  beforeEach(() => {
    restaurar = silenciarLogs();
  });
  afterEach(() => restaurar());

  // ──────────────────────── Efectivo en otra moneda ────────────────────────
  describe('efectivo en dólares o euros', () => {
    it('USD con el cambio en pesos: convierte con la tasa informal y la guarda en el pago', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();

      // 440 CUP = 1,10 USD. Entrega un billete de 5 USD: cambio 3,90 USD = 1 560 CUP.
      const { respuesta, repetida } = await vender(
        e,
        arroz4(e, enMoneda('USD', { '5': 1 }, { monedaCambio: 'CUP' })),
        clave,
      );

      const tasaUsada = {
        tipo: 'tasaMercadoInformal',
        monedaPago: 'USD',
        tasaPago: 400,
        monedaCambio: 'CUP',
        tasaCambio: 1,
        fecha: FECHA_TASAS_BASE,
      };

      expect(repetida).toBe(false);
      expect(respuesta.venta.total).toBe(440);
      expect(respuesta.pago).toMatchObject({
        tipo: 'efectivo',
        montoRecibido: 5,
        cambio: 3.9,
        esCuentaCasa: false,
        moneda: 'USD',
        montoAPagarMoneda: 1.1,
        monedaCambio: 'CUP',
        cambioConvertido: 1560,
        desgloseValidado: { '5': 1 },
      });
      expect(respuesta.pago.tasaUsada).toEqual(tasaUsada);
      expect(respuesta.cambio).toBe(3.9);
      expect(respuesta.cambioConvertido).toBe(1560);
      expect(respuesta.tasaUsada).toEqual(tasaUsada);
      expect(respuesta.advertencias).toEqual([]);

      // Lo guardado: el desglose en USD, lo que se debía en USD y la tasa del momento.
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      const pago = e.modelos.pagoEfectivo.docs[0];
      expect(String(pago._id)).toBe(respuesta.pago._id);
      expect(pago).toMatchObject({
        monto_pagado: 5,
        monto_pagar_CUP: 440,
        monto_pagar_alCambio: 1.1,
        cambio: 3.9,
        moneda: 'USD',
        monedaCambio: 'CUP',
        cambioConvertido: 1560,
        desgloseDenominaciones: [{ valor: 5, cantidad: 1 }],
        metodoPago: 'efectivo',
        esCuentaCasa: false,
      });
      expect(pago.tasaUsada).toEqual(tasaUsada);
      // El desglose anterior (billeteN) es solo de CUP.
      expect(pago.desglose).toBeUndefined();

      // La venta, el Kardex y el Reporte Plus siguen en CUP.
      expect(e.stock(0)).toBe(6);
      expect(e.modelos.ventas.docs[0]).toMatchObject({ total: 440 });
      expect(e.modelos.kardex.docs).toHaveLength(1);
      expect(e.modelos.reportes.docs[0]).toMatchObject({
        cantidadVendida: 4,
        total: 440,
        impuesto: 40,
        metodoPago: 'efectivo',
      });
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.COMPLETADA);
      expect(e.operacion(clave).plan.pago.tasaUsada).toMatchObject({
        tasaPago: 400,
        monedaCambio: 'CUP',
      });
    });

    it('USD con el cambio también en USD: sin conversión, con la tasa guardada', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, enMoneda('USD', { '5': 1 })),
      );

      expect(respuesta.pago).toMatchObject({
        moneda: 'USD',
        montoRecibido: 5,
        montoAPagarMoneda: 1.1,
        cambio: 3.9,
        monedaCambio: 'USD',
      });
      expect(respuesta.cambioConvertido).toBeUndefined();
      expect(respuesta.tasaUsada).toEqual({
        tipo: 'tasaMercadoInformal',
        monedaPago: 'USD',
        tasaPago: 400,
        monedaCambio: 'USD',
        tasaCambio: 400,
        fecha: FECHA_TASAS_BASE,
      });
      expect(e.modelos.pagoEfectivo.docs[0]).toMatchObject({
        moneda: 'USD',
        monedaCambio: 'USD',
        monto_pagar_alCambio: 1.1,
        cambio: 3.9,
      });
      expect(e.modelos.pagoEfectivo.docs[0].cambioConvertido).toBeUndefined();
    });

    it('suma varias denominaciones y acepta el código de moneda en minúsculas y con espacios', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, enMoneda(' usd ', { '1': 1, '5': 1 })),
      );

      expect(respuesta.pago).toMatchObject({
        moneda: 'USD',
        montoRecibido: 6,
        cambio: 4.9,
        desgloseValidado: { '1': 1, '5': 1 },
      });
      expect(e.modelos.pagoEfectivo.docs[0].desgloseDenominaciones).toEqual([
        { valor: 5, cantidad: 1 },
        { valor: 1, cantidad: 1 },
      ]);
    });

    it('USD con el cambio en euros: cambioA × tasaA ÷ tasaB', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, enMoneda('USD', { '5': 1 }, { monedaCambio: 'EUR' })),
      );

      // 3,90 USD × 400 ÷ 450 = 3,47 EUR.
      expect(respuesta.pago).toMatchObject({
        moneda: 'USD',
        cambio: 3.9,
        monedaCambio: 'EUR',
        cambioConvertido: 3.47,
      });
      expect(respuesta.tasaUsada).toMatchObject({
        monedaPago: 'USD',
        tasaPago: 400,
        monedaCambio: 'EUR',
        tasaCambio: 450,
      });
    });

    it('euros con la tasa del Banco Central cuando así está configurado', async () => {
      const e = crearEntorno({ impuesto: 10, tipoTasa: 'tasaBancoCentral' });

      const { respuesta } = await vender(
        e,
        arroz4(e, enMoneda('EUR', { '5': 1 })),
      );

      // 440 ÷ 130 = 3,38 EUR; cambio 1,62 EUR.
      expect(respuesta.pago).toMatchObject({
        moneda: 'EUR',
        montoAPagarMoneda: 3.38,
        montoRecibido: 5,
        cambio: 1.62,
      });
      expect(respuesta.tasaUsada).toMatchObject({
        tipo: 'tasaBancoCentral',
        monedaPago: 'EUR',
        tasaPago: 130,
      });
      expect(e.modelos.pagoEfectivo.docs[0].tasaUsada.tipo).toBe(
        'tasaBancoCentral',
      );
    });

    it('con una tasa nueva registrada, se cobra con la más reciente', async () => {
      const e = crearEntorno({ impuesto: 10 });
      e.modelos.tasas.insertar({
        moneda: 'USD',
        tasaBancoCentral: 120,
        tasaMercadoInformal: 500,
        activa: true,
        fechaActualizacion: new Date('2026-02-01T12:00:00Z'),
      });

      const { respuesta } = await vender(
        e,
        arroz4(e, enMoneda('USD', { '1': 1 })),
      );

      // 440 ÷ 500 = 0,88 USD.
      expect(respuesta.pago).toMatchObject({
        montoAPagarMoneda: 0.88,
        cambio: 0.12,
      });
      expect(respuesta.tasaUsada).toMatchObject({
        tasaPago: 500,
        fecha: new Date('2026-02-01T12:00:00Z'),
      });
    });

    it('pago en pesos con el cambio en dólares (desglose de siempre): guarda moneda y tasa', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, efectivo({ billete1000: 1 }, { monedaCambio: 'USD' })),
      );

      // Cambio: 560 CUP = 1,40 USD.
      expect(respuesta.pago).toMatchObject({
        moneda: 'CUP',
        montoRecibido: 1000,
        montoAPagarMoneda: 440,
        cambio: 560,
        monedaCambio: 'USD',
        cambioConvertido: 1.4,
      });
      expect(respuesta.tasaUsada).toMatchObject({
        monedaPago: 'CUP',
        tasaPago: 1,
        monedaCambio: 'USD',
        tasaCambio: 400,
      });
      expect(e.modelos.pagoEfectivo.docs[0]).toMatchObject({
        moneda: 'CUP',
        monto_pagado: 1000,
        monto_pagar_alCambio: 0,
        monedaCambio: 'USD',
        cambioConvertido: 1.4,
      });
      expect(e.modelos.pagoEfectivo.docs[0].desglose.billete1000).toBe(1);
    });

    it('pesos con el formato nuevo: guarda la moneda y mantiene el desglose billeteN de los reportes', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, enMoneda('CUP', { '500': 1, '100': 1 })),
      );

      expect(respuesta.pago).toMatchObject({
        moneda: 'CUP',
        montoRecibido: 600,
        cambio: 160,
        desgloseValidado: { '500': 1, '100': 1 },
      });
      // Pesos con pesos: no hay tasa que guardar ni cambio que convertir.
      expect(respuesta.tasaUsada).toBeUndefined();
      expect(respuesta.cambioConvertido).toBeUndefined();
      expect(respuesta.pago.montoAPagarMoneda).toBeUndefined();

      const pago = e.modelos.pagoEfectivo.docs[0];
      expect(pago).toMatchObject({
        moneda: 'CUP',
        monto_pagado: 600,
        monto_pagar_alCambio: 0,
        cambio: 160,
      });
      expect(pago.desglose).toMatchObject({
        billete500: 1,
        billete100: 1,
        billete1000: 0,
      });
      expect(pago.desgloseDenominaciones).toEqual([
        { valor: 500, cantidad: 1 },
        { valor: 100, cantidad: 1 },
      ]);
      expect(pago.tasaUsada).toBeUndefined();
    });

    it('el formato anterior de CUP sigue dejando el documento de la Fase 2 (sin moneda ni tasa)', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, efectivo({ billete500: 1, billete100: 1 })),
      );

      expect(respuesta.pago).toMatchObject({ montoRecibido: 600, cambio: 160 });
      for (const campo of [
        'moneda',
        'montoAPagarMoneda',
        'monedaCambio',
        'cambioConvertido',
        'desgloseValidado',
        'tasaUsada',
      ]) {
        expect(respuesta.pago).not.toHaveProperty(campo);
      }
      expect(respuesta).not.toHaveProperty('tasaUsada');

      const pago = e.modelos.pagoEfectivo.docs[0];
      expect(pago).toMatchObject({
        monto_pagado: 600,
        monto_pagar_CUP: 440,
        monto_pagar_alCambio: 0,
        cambio: 160,
      });
      for (const campo of [
        'moneda',
        'monedaCambio',
        'cambioConvertido',
        'desgloseDenominaciones',
        'tasaUsada',
      ]) {
        expect(pago[campo]).toBeUndefined();
      }
    });
  });

  // ──────────────────────── Rechazos del efectivo ────────────────────────
  describe('efectivo rechazado: no toca stock ni deja nada creado', () => {
    it('USD insuficiente: el mensaje habla en USD', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const respuesta = await rechazada(
        e,
        arroz4(e, enMoneda('USD', { '1': 1 })),
        'MONTO_INSUFICIENTE',
      );

      expect(respuesta.message).toBe(
        'El efectivo recibido (1.00 USD) es menor que el total de la venta (1.10 USD)',
      );
    });

    it('un billete que no existe en esa moneda (200 USD) se rechaza', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const respuesta = await rechazada(
        e,
        arroz4(e, enMoneda('USD', { '200': 1 })),
        'DENOMINACION_NO_PERMITIDA',
      );

      expect(String(respuesta.message)).toMatch(/200 no existe para USD/);
    });

    it('cantidades que no son enteros positivos se rechazan', async () => {
      const e = crearEntorno({ impuesto: 10 });

      await rechazada(
        e,
        arroz4(e, enMoneda('USD', { '5': 1.5 })),
        'DESGLOSE_NO_VALIDO',
      );
      await rechazada(
        e,
        arroz4(e, enMoneda('USD', { '5': -1 })),
        'DESGLOSE_NO_VALIDO',
      );
    });

    it('una moneda sin tasa registrada no se puede cobrar', async () => {
      const e = crearEntorno({
        impuesto: 10,
        tasas: [
          { moneda: 'USD', tasaBancoCentral: 120, tasaMercadoInformal: 400 },
        ],
      });

      const respuesta = await rechazada(
        e,
        arroz4(e, enMoneda('EUR', { '5': 1 })),
        'TASA_NO_DISPONIBLE',
      );

      expect(String(respuesta.message)).toMatch(
        /No hay una tasa registrada para EUR/,
      );
    });

    it('una tasa desactivada tampoco', async () => {
      const e = crearEntorno({
        impuesto: 10,
        tasas: [
          {
            moneda: 'USD',
            tasaBancoCentral: 120,
            tasaMercadoInformal: 400,
            activa: false,
          },
        ],
      });

      await rechazada(
        e,
        arroz4(e, enMoneda('USD', { '5': 1 })),
        'TASA_NO_DISPONIBLE',
      );
    });

    it('una tasa en 0 no es válida', async () => {
      const e = crearEntorno({
        impuesto: 10,
        tasas: [
          { moneda: 'USD', tasaBancoCentral: 120, tasaMercadoInformal: 0 },
        ],
      });

      await rechazada(
        e,
        arroz4(e, enMoneda('USD', { '5': 1 })),
        'TASA_NO_VALIDA',
      );
    });

    it('el desglose anterior (billeteN) no sirve para cobrar en dólares', async () => {
      const e = crearEntorno({ impuesto: 10 });

      await rechazada(
        e,
        arroz4(e, {
          tipo: 'efectivo',
          moneda: 'USD',
          desglose: { billete5: 1 },
        }),
        'DESGLOSE_NO_VALIDO',
      );
    });

    it('los dos desgloses a la vez se rechazan', async () => {
      const e = crearEntorno({ impuesto: 10 });

      await rechazada(
        e,
        arroz4(e, {
          tipo: 'efectivo',
          desglose: { billete1000: 1 },
          desgloseDenominaciones: { '1000': 1 },
        }),
        'DESGLOSE_NO_VALIDO',
      );
    });

    it('un desglose vacío en otra moneda: el efectivo es obligatorio', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();

      const fallo = await error(
        vender(e, arroz4(e, enMoneda('USD', { '5': 0 })), clave),
      );

      expect(fallo.getStatus()).toBe(400);
      expect(String(cuerpo(fallo).message)).toMatch(
        /desglose de billetes es obligatorio/,
      );
      stockIntacto(e);
      nadaCreado(e);
    });

    it('con el cambio en una moneda sin tasa: se rechaza antes de vender', async () => {
      const e = crearEntorno({
        impuesto: 10,
        tasas: [
          { moneda: 'USD', tasaBancoCentral: 120, tasaMercadoInformal: 400 },
        ],
      });

      await rechazada(
        e,
        arroz4(e, enMoneda('USD', { '5': 1 }, { monedaCambio: 'EUR' })),
        'TASA_NO_DISPONIBLE',
      );
    });
  });

  // ──────────────────────── Crédito con identidad ────────────────────────
  describe('venta a crédito con CI o NIT', () => {
    it('toma la CI, el teléfono y el prefijo del registro del cliente', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, credito(), conCliente(e)),
      );

      expect(respuesta.pago).toMatchObject({
        tipo: 'credito',
        montoRecibido: 0,
        cambio: 0,
      });
      expect(e.modelos.pagoCredito.docs).toHaveLength(1);
      const pago = e.modelos.pagoCredito.docs[0];
      expect(pago).toMatchObject({
        monto_pagar: 440,
        tipoIdentidad: 'CI',
        ci: CI_CLIENTE_BASE,
        telefono: '53456789',
        codigoPais: '+53',
        metodoPago: 'credito',
      });
      expect(String(pago.clienteId)).toBe(String(clienteBase(e)._id));
      expect(pago.nit).toBeUndefined();
      expect(e.modelos.reportes.docs[0].metodoPago).toBe('credito');
    });

    it('lo que escribe el cajero manda sobre el registro: CI, teléfono y prefijo', async () => {
      const e = crearEntorno({ impuesto: 10 });

      await vender(
        e,
        arroz4(
          e,
          credito({
            tipoIdentidad: 'CI',
            ci: '85051512345',
            telefono: '305-555-0101',
            codigoPais: '+1',
          }),
          conCliente(e),
        ),
      );

      expect(e.modelos.pagoCredito.docs[0]).toMatchObject({
        tipoIdentidad: 'CI',
        ci: '85051512345',
        telefono: '305-555-0101',
        codigoPais: '+1',
      });
    });

    it('con NIT guarda el NIT y ninguna CI', async () => {
      const e = crearEntorno({ impuesto: 10 });

      await vender(
        e,
        arroz4(
          e,
          credito({ tipoIdentidad: 'NIT', nit: 'NIT-2024-001' }),
          conCliente(e),
        ),
      );

      const pago = e.modelos.pagoCredito.docs[0];
      expect(pago).toMatchObject({
        tipoIdentidad: 'NIT',
        nit: 'NIT-2024-001',
        // El teléfono sale del cliente cuando el cajero no escribe otro.
        telefono: '53456789',
      });
      expect(pago.ci).toBeUndefined();
    });

    it('un cliente de tipo NIT: usa el NIT de su registro y nunca lo toma como CI', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const empresa = e.modelos.clientes.insertar({
        id_cliente: 'ABC-12345',
        nombre_cliente: 'Empresa SA',
        tipo_cliente: 'cliente_estandar',
        tipoIdentidad: 'NIT',
        telefono_cliente: '72060000',
        codigoPais: '+53',
      });

      await vender(e, arroz4(e, credito(), { clienteId: String(empresa._id) }));

      const pago = e.modelos.pagoCredito.docs[0];
      expect(pago).toMatchObject({
        tipoIdentidad: 'NIT',
        nit: 'ABC-12345',
        telefono: '72060000',
      });
      expect(pago.ci).toBeUndefined();

      // Pedir CI a un cliente NIT no inventa la CI a partir de su NIT.
      const sinCI = await rechazada2(
        e,
        arroz4(e, credito({ tipoIdentidad: 'CI' }), {
          clienteId: String(empresa._id),
        }),
        'IDENTIDAD_REQUERIDA',
      );
      expect(String(sinCI.message)).toMatch(/La CI del cliente es obligatoria/);
    });

    it.each([
      ['10 dígitos', '9001011234'],
      ['12 dígitos', '900101123456'],
      ['una letra', '9001011234x'],
      ['espacios en medio', '900 1011 2345'],
    ])('la CI con %s se rechaza', async (_motivo, ci) => {
      const e = crearEntorno({ impuesto: 10 });

      const respuesta = await rechazada(
        e,
        arroz4(e, credito({ tipoIdentidad: 'CI', ci }), conCliente(e)),
        'CI_INVALIDA',
      );

      expect(String(respuesta.message)).toMatch(/exactamente 11 dígitos/);
    });

    it('un NIT que no es un código válido se rechaza', async () => {
      const e = crearEntorno({ impuesto: 10 });

      await rechazada(
        e,
        arroz4(e, credito({ tipoIdentidad: 'NIT', nit: 'ab' }), conCliente(e)),
        'NIT_INVALIDO',
      );
      await rechazada(
        e,
        arroz4(
          e,
          credito({ tipoIdentidad: 'NIT', nit: '12 345 678' }),
          conCliente(e),
        ),
        'NIT_INVALIDO',
      );
    });

    it('un cliente sin documento y sin identidad en la petición: se pide la identidad', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const sinDocumento = e.modelos.clientes.insertar({
        nombre_cliente: 'Sin documento',
        tipo_cliente: 'cliente_estandar',
      });

      const respuesta = await rechazada(
        e,
        arroz4(e, credito(), { clienteId: String(sinDocumento._id) }),
        'IDENTIDAD_REQUERIDA',
      );

      expect(String(respuesta.message)).toMatch(
        /La CI del cliente es obligatoria/,
      );
    });

    it('con la CI escrita en la petición, un cliente sin documento sí puede comprar a crédito', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const sinDocumento = e.modelos.clientes.insertar({
        nombre_cliente: 'Sin documento',
        tipo_cliente: 'cliente_estandar',
      });

      await vender(
        e,
        arroz4(e, credito({ ci: '72020212345' }), {
          clienteId: String(sinDocumento._id),
        }),
      );

      const pago = e.modelos.pagoCredito.docs[0];
      expect(pago).toMatchObject({
        tipoIdentidad: 'CI',
        ci: '72020212345',
        codigoPais: '+53',
      });
      expect(pago.telefono).toBeUndefined();
    });

    it.each([
      ['muy corto', '123'],
      ['sin dígitos', 'abcdefg'],
      ['demasiado largo', '1234567890123456'],
    ])(
      'el teléfono escrito por el cajero %s se rechaza',
      async (_motivo, telefono) => {
        const e = crearEntorno({ impuesto: 10 });

        await rechazada(
          e,
          arroz4(e, credito({ telefono }), conCliente(e)),
          'TELEFONO_INVALIDO',
        );
      },
    );

    it('el teléfono que ya estaba en el registro del cliente se guarda tal cual, sin bloquear la venta', async () => {
      const e = crearEntorno({ impuesto: 10 });
      clienteBase(e).telefono_cliente = '12';

      await vender(e, arroz4(e, credito(), conCliente(e)));

      expect(e.modelos.pagoCredito.docs[0].telefono).toBe('12');
    });

    it('una venta a crédito no recibe efectivo ni guarda tasa', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(e, credito(), conCliente(e)),
      );

      expect(respuesta.tasaUsada).toBeUndefined();
      expect(respuesta.pago.moneda).toBeUndefined();
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(0);
      expect(e.modelos.pagoCredito.docs[0].tasaUsada).toBeUndefined();
    });
  });

  // ──────────────────────── Transferencias por canal ────────────────────────
  describe('transferencias: canal, banco y moneda', () => {
    const BANCOS = [
      {
        codigo: 'BPA',
        nombre: 'Banco Popular de Ahorro',
        prefijosTarjeta: ['9225'],
      },
      {
        codigo: 'BANDEC',
        nombre: 'Banco de Crédito y Comercio',
        prefijosTarjeta: ['9227'],
      },
      { codigo: 'BM', nombre: 'Banco Metropolitano' },
    ];

    const bancoId = (e: Entorno, codigo: string): string =>
      String(e.modelos.bancos.docs.find((b) => b.codigo === codigo)?._id);

    it('por banco en CUP: guarda el banco del nomenclador, el canal y el tipo de cuenta', async () => {
      const e = crearEntorno({ impuesto: 10, bancos: BANCOS });

      const { respuesta } = await vender(
        e,
        arroz4(
          e,
          transferencia({
            canal: 'banco',
            bancoId: bancoId(e, 'BPA'),
            tipoCuenta: 'cuenta',
            numeroCuenta: '0123456789',
          }),
        ),
      );

      expect(respuesta.advertencias).toEqual([]);
      expect(respuesta.pago.tipo).toBe('transferencia');
      expect(respuesta.pago.moneda).toBeUndefined();
      expect(respuesta.tasaUsada).toBeUndefined();

      const pago = e.modelos.pagoTransferencia.docs[0];
      expect(pago).toMatchObject({
        montoPagar: 440,
        numeroCuenta: '0123456789',
        banco: 'BPA',
        tipoCuenta: 'cuenta',
        canal: 'banco',
        metodoPago: 'transferencia',
      });
      expect(String(pago.bancoId)).toBe(bancoId(e, 'BPA'));
      // En pesos no hay moneda ni tasa que guardar.
      expect(pago.moneda).toBeUndefined();
      expect(pago.tasaUsada).toBeUndefined();
      expect(e.modelos.reportes.docs[0].metodoPago).toBe('transferencia');
    });

    it('una tarjeta que parece de otro banco: avisa en la respuesta y vende igual', async () => {
      const e = crearEntorno({ impuesto: 10, bancos: BANCOS });

      const { respuesta } = await vender(
        e,
        arroz4(
          e,
          transferencia({
            bancoId: bancoId(e, 'BANDEC'),
            tipoCuenta: 'tarjeta',
            numeroCuenta: '9225 1234 5678 9012',
          }),
        ),
      );

      expect(respuesta.advertencias).toHaveLength(1);
      expect(respuesta.advertencias[0]).toMatch(
        /parece de Banco Popular de Ahorro \(BPA\), no de Banco de Crédito y Comercio \(BANDEC\)/,
      );
      expect(respuesta.advertencias[0]).toMatch(/no bloquea el cobro/);

      // La venta se hizo completa y con el banco que eligió el cajero.
      expect(e.stock(0)).toBe(6);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.modelos.pagoTransferencia.docs[0]).toMatchObject({
        banco: 'BANDEC',
        tipoCuenta: 'tarjeta',
        numeroCuenta: '9225 1234 5678 9012',
      });
    });

    it('una tarjeta sin ningún prefijo conocido: avisa distinto y también vende', async () => {
      const e = crearEntorno({ impuesto: 10, bancos: BANCOS });

      const { respuesta } = await vender(
        e,
        arroz4(
          e,
          transferencia({
            bancoId: bancoId(e, 'BPA'),
            tipoCuenta: 'tarjeta',
            numeroCuenta: '1111 2222 3333 4444',
          }),
        ),
      );

      expect(respuesta.advertencias).toHaveLength(1);
      expect(respuesta.advertencias[0]).toMatch(
        /no empieza con ninguno de los prefijos/,
      );
      expect(e.modelos.ventas.docs).toHaveLength(1);
    });

    it('sin aviso cuando la tarjeta es del banco elegido, cuando es una cuenta o cuando el banco no tiene prefijos', async () => {
      const e = crearEntorno({ impuesto: 10, bancos: BANCOS });

      const propia = await vender(
        e,
        arroz4(
          e,
          transferencia({
            bancoId: bancoId(e, 'BPA'),
            tipoCuenta: 'tarjeta',
            numeroCuenta: '9225123412341234',
          }),
        ),
      );
      const cuenta = await vender(
        e,
        dtoCheckout(
          e,
          [{ i: 1, cantidad: 1 }],
          transferencia({
            bancoId: bancoId(e, 'BANDEC'),
            tipoCuenta: 'cuenta',
            numeroCuenta: '9225123412341234',
          }),
        ),
      );
      const sinPrefijos = await vender(
        e,
        dtoCheckout(
          e,
          [{ i: 1, cantidad: 1 }],
          transferencia({
            bancoId: bancoId(e, 'BM'),
            tipoCuenta: 'tarjeta',
            numeroCuenta: '9999999999999999',
          }),
        ),
      );

      expect(propia.respuesta.advertencias).toEqual([]);
      expect(cuenta.respuesta.advertencias).toEqual([]);
      expect(sinPrefijos.respuesta.advertencias).toEqual([]);
      expect(e.modelos.ventas.docs).toHaveLength(3);
    });

    it('Zelle es un canal en dólares: cobra el total convertido y guarda la tasa', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await vender(
        e,
        arroz4(
          e,
          transferencia({ canal: 'zelle', numeroCuenta: 'ZELLE-9981' }),
        ),
      );

      const tasaUsada = {
        tipo: 'tasaMercadoInformal',
        monedaPago: 'USD',
        tasaPago: 400,
        fecha: FECHA_TASAS_BASE,
      };
      expect(respuesta.pago).toMatchObject({
        tipo: 'transferencia',
        montoRecibido: 0,
        cambio: 0,
        moneda: 'USD',
        montoAPagarMoneda: 1.1,
      });
      expect(respuesta.tasaUsada).toEqual(tasaUsada);
      expect(respuesta.cambioConvertido).toBeUndefined();

      const pago = e.modelos.pagoTransferencia.docs[0];
      expect(pago).toMatchObject({
        montoPagar: 440,
        numeroCuenta: 'ZELLE-9981',
        canal: 'zelle',
        moneda: 'USD',
        montoMoneda: 1.1,
        metodoPago: 'transferencia',
      });
      expect(pago.tasaUsada).toEqual(tasaUsada);
      // Zelle no necesita banco del nomenclador.
      expect(pago.bancoId).toBeUndefined();
    });

    it('Zelle con la tasa del Banco Central cuando así está configurado', async () => {
      const e = crearEntorno({ impuesto: 10, tipoTasa: 'tasaBancoCentral' });

      const { respuesta } = await vender(
        e,
        arroz4(e, transferencia({ canal: 'zelle', referenciaPago: 'Z-1' })),
      );

      // 440 ÷ 120 = 3,67 USD.
      expect(respuesta.pago).toMatchObject({
        moneda: 'USD',
        montoAPagarMoneda: 3.67,
      });
      expect(respuesta.tasaUsada).toMatchObject({
        tipo: 'tasaBancoCentral',
        tasaPago: 120,
      });
    });

    it('un banco en otra moneda (canal banco con moneda USD) también guarda la tasa', async () => {
      const e = crearEntorno({ impuesto: 10, bancos: BANCOS });

      const { respuesta } = await vender(
        e,
        arroz4(
          e,
          transferencia({
            canal: 'banco',
            bancoId: bancoId(e, 'BPA'),
            moneda: 'USD',
            numeroCuenta: 'CTA-USD-1',
          }),
        ),
      );

      expect(respuesta.pago).toMatchObject({
        moneda: 'USD',
        montoAPagarMoneda: 1.1,
      });
      expect(e.modelos.pagoTransferencia.docs[0]).toMatchObject({
        moneda: 'USD',
        montoMoneda: 1.1,
        banco: 'BPA',
      });
    });

    it('Transfermóvil y EnZona van en CUP y no piden banco', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const tm = await vender(
        e,
        arroz4(
          e,
          transferencia({ canal: 'transfermovil', referenciaPago: 'TM-0001' }),
        ),
      );
      const ez = await vender(
        e,
        dtoCheckout(
          e,
          [{ i: 1, cantidad: 2 }],
          transferencia({ canal: 'enzona', referenciaPago: 'EZ-0002' }),
        ),
      );

      expect(tm.respuesta.pago.moneda).toBeUndefined();
      expect(ez.respuesta.pago.moneda).toBeUndefined();
      expect(e.modelos.pagoTransferencia.docs.map((d) => d.canal)).toEqual([
        'transfermovil',
        'enzona',
      ]);
      expect(e.modelos.pagoTransferencia.docs[0].banco).toBeUndefined();
      expect(e.modelos.pagoTransferencia.docs[1]).toMatchObject({
        montoPagar: 110,
        referenciaPago: 'EZ-0002',
      });
    });

    it('el texto libre `banco` del diálogo anterior sigue valiendo', async () => {
      const e = crearEntorno({ impuesto: 10, bancos: BANCOS });

      await vender(
        e,
        arroz4(e, transferencia({ numeroCuenta: 'TRF-123', banco: 'bpa' })),
      );
      await vender(
        e,
        dtoCheckout(
          e,
          [{ i: 1, cantidad: 1 }],
          transferencia({ numeroCuenta: 'TRF-456', banco: 'Otro Banco' }),
        ),
      );

      const [conocido, libre] = e.modelos.pagoTransferencia.docs;
      expect(conocido.banco).toBe('BPA');
      expect(String(conocido.bancoId)).toBe(bancoId(e, 'BPA'));
      // Un banco que no está en el nomenclador se guarda como texto, sin validarlo.
      expect(libre.banco).toBe('Otro Banco');
      expect(libre.bancoId).toBeUndefined();
    });

    it('un banco que no existe o está desactivado se rechaza antes de vender', async () => {
      const e = crearEntorno({
        impuesto: 10,
        bancos: [
          ...BANCOS,
          { codigo: 'VIEJO', nombre: 'Banco antiguo', activo: false },
        ],
      });

      await rechazada(
        e,
        arroz4(
          e,
          transferencia({ bancoId: bancoId(e, 'VIEJO'), numeroCuenta: 'X-1' }),
        ),
        'BANCO_NO_VALIDO',
      );
      await rechazada(
        e,
        arroz4(
          e,
          transferencia({
            bancoId: String(new Types.ObjectId()),
            numeroCuenta: 'X-2',
          }),
        ),
        'BANCO_NO_VALIDO',
      );
    });

    it('Zelle sin tasa de dólares registrada: se rechaza y no queda nada', async () => {
      const e = crearEntorno({
        impuesto: 10,
        tasas: [
          { moneda: 'EUR', tasaBancoCentral: 130, tasaMercadoInformal: 450 },
        ],
      });

      await rechazada(
        e,
        arroz4(e, transferencia({ canal: 'zelle', referenciaPago: 'Z-2' })),
        'TASA_NO_DISPONIBLE',
      );
    });
  });

  // ──────────────────── Idempotencia: el reintento del cajero ────────────────────
  describe('reintento con la misma clave', () => {
    it('devuelve la misma venta con la tasa de entonces, aunque la tasa haya cambiado', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      const dto = arroz4(
        e,
        enMoneda('USD', { '5': 1 }, { monedaCambio: 'CUP' }),
      );

      const primera = await vender(e, dto, clave);
      cambiarTasa(e, 'USD', 500);
      const segunda = await vender(e, dto, clave);

      expect(primera.repetida).toBe(false);
      expect(segunda.repetida).toBe(true);
      expect(segunda.respuesta.venta._id).toBe(primera.respuesta.venta._id);
      expect(segunda.respuesta.pago._id).toBe(primera.respuesta.pago._id);
      expect(segunda.respuesta.cambioConvertido).toBe(1560);
      expect(segunda.respuesta.tasaUsada).toEqual(primera.respuesta.tasaUsada);
      expect(segunda.respuesta.tasaUsada?.tasaPago).toBe(400);

      // Un solo cobro y un solo descuento.
      expect(e.stock(0)).toBe(6);
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(e.modelos.pagoEfectivo.docs[0].tasaUsada.tasaPago).toBe(400);
    });

    it('la misma clave con otra moneda de pago es otra petición: 422 y nada cambia', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      await vender(e, arroz4(e, enMoneda('USD', { '5': 1 })), clave);

      const fallo = await error(
        vender(e, arroz4(e, enMoneda('EUR', { '5': 1 })), clave),
      );

      expect(fallo.getStatus()).toBe(422);
      expect(e.stock(0)).toBe(6);
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(e.modelos.pagoEfectivo.docs[0].moneda).toBe('USD');
    });

    it('la misma clave con otra identidad de crédito también es otra petición', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      await vender(
        e,
        arroz4(e, credito({ ci: '85051512345' }), conCliente(e)),
        clave,
      );

      const fallo = await error(
        vender(
          e,
          arroz4(e, credito({ ci: '85051599999' }), conCliente(e)),
          clave,
        ),
      );

      expect(fallo.getStatus()).toBe(422);
      expect(e.modelos.pagoCredito.docs).toHaveLength(1);
      expect(e.modelos.pagoCredito.docs[0].ci).toBe('85051512345');
    });

    it('un pago rechazado se puede corregir y reintentar con la misma clave', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();

      const fallo = await error(
        vender(e, arroz4(e, enMoneda('USD', { '1': 1 })), clave),
      );
      expect(cuerpo(fallo).codigo).toBe('MONTO_INSUFICIENTE');

      // Con otro billete la petición es distinta; se hace con una clave nueva.
      const { respuesta } = await vender(
        e,
        arroz4(e, enMoneda('USD', { '5': 1 })),
      );

      expect(respuesta.pago.cambio).toBe(3.9);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.stock(0)).toBe(6);
    });
  });

  // ──────────────────── La caída del servidor conserva lo cobrado ────────────────────
  describe('caída del servidor tras confirmar la venta', () => {
    it('efectivo en USD: la recuperación usa la tasa de la venta, no la de ahora', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      const dto = arroz4(
        e,
        enMoneda('USD', { '5': 1 }, { monedaCambio: 'CUP' }),
      );

      await ventaQueSeCaeAntesDelPago(e, e.modelos.pagoEfectivo, dto, clave);
      // Mientras el servidor estaba caído, alguien actualizó la tasa.
      cambiarTasa(e, 'USD', 500);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'completada' }]);
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(e.modelos.pagoEfectivo.docs[0]).toMatchObject({
        monto_pagado: 5,
        monto_pagar_CUP: 440,
        monto_pagar_alCambio: 1.1,
        cambio: 3.9,
        moneda: 'USD',
        monedaCambio: 'CUP',
        cambioConvertido: 1560,
        desgloseDenominaciones: [{ valor: 5, cantidad: 1 }],
      });
      expect(e.modelos.pagoEfectivo.docs[0].tasaUsada).toEqual({
        tipo: 'tasaMercadoInformal',
        monedaPago: 'USD',
        tasaPago: 400,
        monedaCambio: 'CUP',
        tasaCambio: 1,
        fecha: FECHA_TASAS_BASE,
      });
      expect(e.stock(0)).toBe(6);
      expect(e.modelos.ventas.docs).toHaveLength(1);

      // El cajero reintenta y recibe lo mismo que se guardó.
      const reintento = await vender(e, dto, clave);
      expect(reintento.repetida).toBe(true);
      expect(reintento.respuesta.cambioConvertido).toBe(1560);
      expect(reintento.respuesta.tasaUsada?.tasaPago).toBe(400);
      expect(reintento.respuesta.pago._id).toBe(
        String(e.modelos.pagoEfectivo.docs[0]._id),
      );
    });

    it('Zelle: la recuperación guarda la tasa y el monto en dólares del momento de la venta', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      const dto = arroz4(
        e,
        transferencia({ canal: 'zelle', numeroCuenta: 'ZELLE-77' }),
      );

      await ventaQueSeCaeAntesDelPago(
        e,
        e.modelos.pagoTransferencia,
        dto,
        clave,
      );
      cambiarTasa(e, 'USD', 600);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'completada' }]);
      expect(e.modelos.pagoTransferencia.docs).toHaveLength(1);
      expect(e.modelos.pagoTransferencia.docs[0]).toMatchObject({
        canal: 'zelle',
        moneda: 'USD',
        montoMoneda: 1.1,
        montoPagar: 440,
      });
      expect(e.modelos.pagoTransferencia.docs[0].tasaUsada.tasaPago).toBe(400);
    });

    it('transferencia con banco y tarjeta: la recuperación conserva el banco', async () => {
      const e = crearEntorno({
        impuesto: 10,
        bancos: [
          {
            codigo: 'BPA',
            nombre: 'Banco Popular de Ahorro',
            prefijosTarjeta: ['9225'],
          },
        ],
      });
      const clave = claveNueva();
      const banco = e.modelos.bancos.docs[0];
      const dto = arroz4(
        e,
        transferencia({
          bancoId: String(banco._id),
          tipoCuenta: 'tarjeta',
          numeroCuenta: '9225123412341234',
        }),
      );

      await ventaQueSeCaeAntesDelPago(
        e,
        e.modelos.pagoTransferencia,
        dto,
        clave,
      );
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'completada' }]);
      const pago = e.modelos.pagoTransferencia.docs[0];
      expect(pago).toMatchObject({
        banco: 'BPA',
        tipoCuenta: 'tarjeta',
        canal: 'banco',
      });
      expect(pago.bancoId).toBeInstanceOf(Types.ObjectId);
      expect(String(pago.bancoId)).toBe(String(banco._id));
    });

    it('crédito: la recuperación guarda la identidad y el teléfono de la venta, no los de ahora', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      const dto = arroz4(e, credito(), conCliente(e));

      await ventaQueSeCaeAntesDelPago(e, e.modelos.pagoCredito, dto, clave);
      // El registro del cliente cambió mientras tanto.
      clienteBase(e).id_cliente = '11111111111';
      clienteBase(e).telefono_cliente = '99999999';
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'completada' }]);
      expect(e.modelos.pagoCredito.docs).toHaveLength(1);
      expect(e.modelos.pagoCredito.docs[0]).toMatchObject({
        tipoIdentidad: 'CI',
        ci: CI_CLIENTE_BASE,
        telefono: '53456789',
        codigoPais: '+53',
        monto_pagar: 440,
      });
    });
  });

  // ──────────────────── El plan guardado se lee bien ────────────────────
  describe('plan de la operación', () => {
    it('lo guardado se vuelve a leer con sus fechas e ids aunque lleguen como texto', async () => {
      const e = crearEntorno({
        impuesto: 10,
        bancos: [{ codigo: 'BPA', nombre: 'Banco Popular de Ahorro' }],
      });
      const clave = claveNueva();
      const banco = e.modelos.bancos.docs[0];

      await vender(
        e,
        arroz4(
          e,
          transferencia({
            canal: 'banco',
            bancoId: String(banco._id),
            moneda: 'USD',
            numeroCuenta: 'CTA-1',
          }),
          conCliente(e),
        ),
        clave,
      );

      // Como si la base lo hubiera devuelto serializado: ids y fechas en texto.
      const bruto = JSON.parse(JSON.stringify(e.operacion(clave).plan));
      expect(typeof bruto.pago.tasaUsada.fecha).toBe('string');
      expect(typeof bruto.pago.documento.bancoId).toBe('string');

      const plan = leerPlan(bruto);

      expect(plan).toBeDefined();
      expect(plan?.pago.tasaUsada?.fecha).toBeInstanceOf(Date);
      expect(plan?.pago.tasaUsada?.fecha?.toISOString()).toBe(
        FECHA_TASAS_BASE.toISOString(),
      );
      expect(plan?.pago.documento.tasaUsada).toBeDefined();
      expect(
        (plan?.pago.documento.tasaUsada as { fecha: unknown }).fecha,
      ).toBeInstanceOf(Date);
      expect(plan?.pago.documento.bancoId).toBeInstanceOf(Types.ObjectId);
      expect(String(plan?.pago.documento.bancoId)).toBe(String(banco._id));
      expect(plan?.pago.documento.clienteId).toBeInstanceOf(Types.ObjectId);
    });

    it('un plan de la Fase 2 (sin ningún campo nuevo) sigue siendo legible', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      await vender(e, arroz4(e, efectivo({ billete1000: 1 })), clave);

      const plan = leerPlan(
        JSON.parse(JSON.stringify(e.operacion(clave).plan)),
      );

      expect(plan?.pago).toMatchObject({
        tipo: 'efectivo',
        montoRecibido: 1000,
        cambio: 560,
      });
      expect(plan?.pago.tasaUsada).toBeUndefined();
      expect(plan?.pago.moneda).toBeUndefined();
    });
  });
});

/**
 * Como `rechazada`, para ventas que ya hicieron otra venta antes en la misma
 * prueba: solo comprueba el rechazo y que esta segunda venta no dejó nada nuevo.
 */
async function rechazada2(
  e: Entorno,
  dto: CreateCheckoutDto,
  codigo: string,
): Promise<Record<string, unknown>> {
  const ventas = e.modelos.ventas.docs.length;
  const pagos = e.modelos.pagoCredito.docs.length;
  const clave = claveNueva();
  const fallo = await error(vender(e, dto, clave));

  expect(fallo.getStatus()).toBe(400);
  expect(cuerpo(fallo).codigo).toBe(codigo);
  expect(e.modelos.ventas.docs).toHaveLength(ventas);
  expect(e.modelos.pagoCredito.docs).toHaveLength(pagos);
  expect(e.operacion(clave).estado).toBe(EstadoOperacion.FALLIDA);

  return cuerpo(fallo);
}
