/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EstadoOperacion } from '../../../operacion-idempotente/schema/operacion-idempotente.schema';
import { UsuarioRol } from '../../../auth/schemas/usuarios.schema';
import { KardexTipo } from '../../kardex/schema/kardex.schema';
import { DESCUENTO_MAXIMO_POR_ROL } from './checkout-politica';
import {
  claveNueva,
  crearEntorno,
  dtoCheckout,
  efectivo,
  Entorno,
  silenciarLogs,
} from './checkout-entorno-spec';

/**
 * Checkout transaccional (Fase 2) contra una base en memoria con los
 * servicios reales. Catálogo base (precio · stock):
 *   [0] Arroz 100 · 10     [1] Frijol 50 · 20     [2] Aceite 33,33 · 6
 * Cajero con el módulo de punto de venta. Impuesto 10 % salvo que se diga otra cosa.
 */

/** Ejecuta y devuelve el error (falla la prueba si no lo hubo). */
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

/** Lo que NO debe existir si la venta no se hizo. */
function nadaCreado(e: Entorno): void {
  expect(e.modelos.ventas.docs).toHaveLength(0);
  expect(e.modelos.pagoEfectivo.docs).toHaveLength(0);
  expect(e.modelos.pagoCredito.docs).toHaveLength(0);
  expect(e.modelos.pagoTransferencia.docs).toHaveLength(0);
  expect(e.modelos.kardex.docs).toHaveLength(0);
  expect(e.modelos.reportes.docs).toHaveLength(0);
}

describe('CheckoutService — checkout transaccional (Fase 2)', () => {
  let restaurar: () => void;

  beforeEach(() => {
    restaurar = silenciarLogs();
  });
  afterEach(() => restaurar());

  // ─────────────────────────── Camino feliz ───────────────────────────
  describe('venta en efectivo (inventario por producto)', () => {
    it('cobra, descuenta el stock y deja pago, venta, Kardex y Reporte Plus', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();

      const { respuesta, repetida } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [
            { i: 0, cantidad: 2 },
            { i: 1, cantidad: 3 },
          ],
          efectivo({ billete1000: 1 }),
        ),
        clave,
        e.usuario(),
      );

      // Respuesta: siempre los totales del servidor.
      expect(repetida).toBe(false);
      expect(respuesta.comprobante).toBe('V-000001');
      expect(respuesta.venta).toMatchObject({
        comprobante: 'V-000001',
        subtotal: 350,
        descuento: 0,
        impuestoPorciento: 10,
        impuesto: 35,
        total: 385,
      });
      expect(respuesta.venta.items).toHaveLength(2);
      expect(respuesta.venta.items[0]).toMatchObject({
        productoId: String(e.P[0]),
        codigo: 'ARR-1',
        nombre: 'Arroz',
        cantidad: 2,
        precioUnitario: 100,
        subtotal: 200,
        impuesto: 20,
        total: 220,
        stockRestante: 8,
      });
      expect(respuesta.pago).toMatchObject({
        tipo: 'efectivo',
        montoRecibido: 1000,
        cambio: 615,
        esCuentaCasa: false,
      });
      expect(respuesta.cambio).toBe(615);
      expect(respuesta.advertencias).toEqual([]);
      expect(respuesta.idempotencia).toEqual({
        clave,
        estado: 'completada',
        repetida: false,
      });

      // Stock.
      expect(e.stock(0)).toBe(8);
      expect(e.stock(1)).toBe(17);
      expect(e.stock(2)).toBe(6);

      // Venta con lo que calculó el servidor.
      expect(e.modelos.ventas.docs).toHaveLength(1);
      const venta = e.modelos.ventas.docs[0];
      expect(String(venta._id)).toBe(respuesta.venta._id);
      expect(venta).toMatchObject({
        comprobante: 'V-000001',
        subtotal_venta: 350,
        descuento_total: 0,
        impuesto: 35,
        impuestoPorciento: 10,
        total: 385,
        usuario: 'cajero1',
        operacion: clave,
      });
      expect(String(venta.pago)).toBe(respuesta.pago._id);
      expect(venta.productos).toHaveLength(2);
      expect(venta.productos[0]).toMatchObject({
        codigo: 'ARR-1',
        cantidad: 2,
        precioUnitario: 100,
        total: 220,
      });
      expect(venta.createdAt).toBeInstanceOf(Date);

      // Pago de efectivo con el id que se devolvió.
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(String(e.modelos.pagoEfectivo.docs[0]._id)).toBe(
        respuesta.pago._id,
      );
      expect(e.modelos.pagoEfectivo.docs[0]).toMatchObject({
        monto_pagado: 1000,
        monto_pagar_CUP: 385,
        cambio: 615,
        metodoPago: 'efectivo',
      });

      // Kardex al momento de la venta, con el stock que quedó.
      expect(e.modelos.kardex.docs).toHaveLength(2);
      expect(e.modelos.kardex.docs[0]).toMatchObject({
        tipo: KardexTipo.VENTA,
        cantidad: 2,
        stock: 8,
        referencia: 'V-000001',
      });
      expect(String(e.modelos.kardex.docs[0].productoId)).toBe(String(e.P[0]));

      // Reporte Plus ya contado en el Kardex (el cierre de turno no lo duplica).
      expect(e.modelos.reportes.docs).toHaveLength(2);
      expect(e.modelos.reportes.docs[0]).toMatchObject({
        cantidadVendida: 2,
        stockFinal: 8,
        metodoPago: 'efectivo',
        total: 220,
        impuesto: 20,
        origen: 'venta',
        enKardex: true,
        referencia: respuesta.venta._id,
      });

      // La operación quedó completada con su respuesta y su rastro.
      const op = e.operacion(clave);
      expect(op.estado).toBe(EstadoOperacion.COMPLETADA);
      expect(op.respuesta.comprobante).toBe('V-000001');
      expect(e.pasos(clave)).toEqual([
        'plan:registrado',
        'stock:iniciado#0',
        'stock:hecho#0',
        'stock:iniciado#1',
        'stock:hecho#1',
        'confirmacion:iniciada',
        'operacion:completada',
      ]);
    });

    it('los comprobantes son correlativos', async () => {
      const e = crearEntorno();

      const comprobantes: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { respuesta } = await e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 1, cantidad: 1 }]),
          claveNueva(),
          e.usuario(),
        );
        comprobantes.push(respuesta.comprobante);
      }

      expect(comprobantes).toEqual(['V-000001', 'V-000002', 'V-000003']);
    });

    it('con descuento por línea e impuesto, redondeando como la factura', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [
            { i: 0, cantidad: 2, descuentoPct: 10 },
            { i: 1, cantidad: 3 },
          ],
          efectivo({ billete500: 1 }),
        ),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.venta).toMatchObject({
        subtotal: 350,
        descuento: 20,
        impuesto: 33,
        total: 363,
      });
      expect(respuesta.cambio).toBe(137);
      expect(e.modelos.reportes.docs[0]).toMatchObject({
        descuento: 20,
        total: 198,
      });
    });

    it('sin impuesto configurado se cobra con 0 % (el POS no tenía impuesto)', async () => {
      const e = crearEntorno();

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], efectivo({ billete100: 1 })),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.venta).toMatchObject({
        impuestoPorciento: 0,
        impuesto: 0,
        total: 100,
      });
      expect(respuesta.cambio).toBe(0);
    });

    it('avisa (en logs) cuando el producto queda por debajo de su stock mínimo', async () => {
      const e = crearEntorno();
      const aviso = jest.spyOn(Logger.prototype, 'warn');

      await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 9 }], efectivo({ billete1000: 1 })),
        claveNueva(),
        e.usuario(),
      );

      expect(aviso).toHaveBeenCalledWith(
        expect.stringContaining('STOCK BAJO: Arroz'),
      );
    });

    it('con cliente guarda su id y nombre en la venta', async () => {
      const e = crearEntorno();
      const cliente = e.modelos.clientes.docs[0];

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 1, cantidad: 1 }], efectivo({ billete50: 1 }), {
          clienteId: String(cliente._id),
        }),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.venta.clienteNombre).toBe('Juan Pérez');
      expect(String(e.modelos.ventas.docs[0].clienteId)).toBe(
        String(cliente._id),
      );
    });
  });

  // ─────────────────────────── Inventario unificado ───────────────────────────
  describe('inventario por ubicación (Fase 1 activa)', () => {
    const repartido = [
      {
        codigo: 'ARR-1',
        nombre: 'Arroz',
        precio: 100,
        stock: 10,
        filas: [
          { contenedor: 1 as const, cantidad: 6 },
          { contenedor: 2 as const, cantidad: 3 },
          { contenedor: 3 as const, cantidad: 1 },
        ],
      },
    ];

    it('descuenta de las ubicaciones, deja el rastro en la venta y mantiene el total sincronizado', async () => {
      const e = crearEntorno({ unificado: true, productos: repartido });

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 8 }], efectivo({ billete1000: 1 })),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.venta.items[0].stockRestante).toBe(2);
      expect(e.stock(0)).toBe(2);
      expect(e.sumaExistencias(0)).toBe(2);

      const ubicaciones = e.modelos.ventas.docs[0].productos[0].ubicaciones;
      expect(
        ubicaciones.reduce(
          (s: number, u: { cantidad: number }) => s + u.cantidad,
          0,
        ),
      ).toBe(8);
      for (const u of ubicaciones) {
        expect(u.almacen).toBeInstanceOf(Types.ObjectId);
        expect(u.contenedor).toBeInstanceOf(Types.ObjectId);
      }
    });

    it('con una ubicación de origen, sale de esa ubicación', async () => {
      const e = crearEntorno({ unificado: true, productos: repartido });

      await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 2 }], efectivo({ billete500: 1 }), {
          almacenId: String(e.A1),
          ubicacionOrigen: { contenedorId: String(e.C2) },
        }),
        claveNueva(),
        e.usuario(),
      );

      expect(e.cantidadEn(0, 2)).toBe(1);
      expect(e.cantidadEn(0, 1)).toBe(6);
      expect(e.stock(0)).toBe(8);
    });

    it('con ids guardados como texto (datos antiguos) funciona igual y escribe ObjectId', async () => {
      const e = crearEntorno({
        unificado: true,
        idsComoTexto: true,
        productos: repartido,
      });

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 7 }], efectivo({ billete1000: 1 })),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.venta.items[0].stockRestante).toBe(3);
      expect(e.stock(0)).toBe(3);
      expect(e.sumaExistencias(0)).toBe(3);
      for (const u of e.modelos.ventas.docs[0].productos[0].ubicaciones) {
        expect(u.contenedor).toBeInstanceOf(Types.ObjectId);
      }
    });

    it('sin unificar, ignora la ubicación de origen y avisa', async () => {
      const e = crearEntorno();

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], efectivo({ billete100: 1 }), {
          almacenId: String(e.A1),
          ubicacionOrigen: { contenedorId: String(e.C1) },
        }),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.advertencias.join(' ')).toMatch(/no está unificado/);
      expect(e.stock(0)).toBe(9);
    });
  });

  // ─────────────────────────── El cliente no manda totales ───────────────────────────
  describe('los totales los calcula el servidor', () => {
    it('unos totales alterados en `estimado` no cambian lo cobrado y se avisa', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 2 }], efectivo({ billete1000: 1 }), {
          estimado: { subtotal: 1, descuento: 0, impuesto: 0, total: 1 },
        }),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.venta.total).toBe(220);
      expect(e.modelos.ventas.docs[0].total).toBe(220);
      expect(e.modelos.pagoEfectivo.docs[0].monto_pagar_CUP).toBe(220);
      expect(respuesta.advertencias.join(' ')).toMatch(
        /no coinciden con los del servidor/,
      );
    });

    it('si el estimado coincide no hay advertencia', async () => {
      const e = crearEntorno({ impuesto: 10 });

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 2 }], efectivo({ billete1000: 1 }), {
          estimado: { subtotal: 200, descuento: 0, impuesto: 20, total: 220 },
        }),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.advertencias).toEqual([]);
    });

    it('el precio sale del producto: si cambia en la base, se cobra el nuevo', async () => {
      const e = crearEntorno();
      e.modelos.productos.docs[0].precio_venta = 120;

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], efectivo({ billete200: 1 })),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.venta.total).toBe(120);
      expect(respuesta.cambio).toBe(80);
    });
  });

  // ─────────────────────────── Rechazos antes de tocar el stock ───────────────────────────
  describe('rechazos que no tocan el stock', () => {
    it('efectivo insuficiente: 400, nada creado y la operación queda fallida', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 2 }], efectivo({ billete100: 2 })),
          clave,
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(400);
      expect(String(cuerpo(fallo).message)).toMatch(/menor que el total/);
      expect(e.stock(0)).toBe(10);
      nadaCreado(e);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.FALLIDA);
      expect(e.operacion(clave).error.codigoHttp).toBe(400);
      expect(e.pasos(clave)).toEqual(['operacion:fallida']);
    });

    it('producto inexistente: 404 sin tocar nada', async () => {
      const e = crearEntorno();

      const fallo = await error(
        e.checkout.ejecutar(
          {
            items: [
              { productoId: String(e.P[0]), cantidad: 1 },
              { productoId: String(new Types.ObjectId()), cantidad: 1 },
            ],
            pago: efectivo({ billete1000: 1 }),
          },
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(fallo).toBeInstanceOf(NotFoundException);
      expect(e.stock(0)).toBe(10);
      nadaCreado(e);
    });

    it('cliente inexistente: 404 sin tocar nada', async () => {
      const e = crearEntorno();

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 1 }], efectivo({ billete100: 1 }), {
            clienteId: String(new Types.ObjectId()),
          }),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(fallo).toBeInstanceOf(NotFoundException);
      expect(e.stock(0)).toBe(10);
    });

    it('el mismo producto dos veces en la venta: 400', async () => {
      const e = crearEntorno();

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [
            { i: 0, cantidad: 1 },
            { i: 0, cantidad: 2 },
          ]),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(400);
      expect(e.stock(0)).toBe(10);
    });

    it('un total de 0 (descuento del 100 %) se rechaza', async () => {
      const e = crearEntorno();

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 1, descuentoPct: 100 }]),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(String(cuerpo(fallo).message)).toMatch(/mayor que 0/);
      expect(e.stock(0)).toBe(10);
    });

    it('un impuesto inválido en la configuración detiene la venta', async () => {
      const e = crearEntorno({ impuesto: 150 });

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 1 }]),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(500);
      expect(e.stock(0)).toBe(10);
      nadaCreado(e);
    });

    it('a crédito sin cliente: 400', async () => {
      const e = crearEntorno();

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 1 }], { tipo: 'credito' }),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(String(cuerpo(fallo).message)).toMatch(/cliente es obligatorio/);
      expect(e.stock(0)).toBe(10);
    });

    it('transferencia sin referencia o sin banco: 400', async () => {
      const e = crearEntorno();

      const sinReferencia = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 1 }], {
            tipo: 'transferencia',
            banco: 'BPA',
          }),
          claveNueva(),
          e.usuario(),
        ),
      );
      const sinBanco = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 1 }], {
            tipo: 'transferencia',
            numeroCuenta: '9999',
          }),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(String(cuerpo(sinReferencia).message)).toMatch(/referencia/);
      expect(String(cuerpo(sinBanco).message)).toMatch(/banco/);
      expect(e.stock(0)).toBe(10);
    });
  });

  // ─────────────────────────── Otros medios de pago ───────────────────────────
  describe('otros medios de pago', () => {
    it('a crédito con cliente: pago de crédito y el reporte lo marca como crédito', async () => {
      const e = crearEntorno();
      const cliente = e.modelos.clientes.docs[0];

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [{ i: 0, cantidad: 2 }],
          { tipo: 'credito' },
          { clienteId: String(cliente._id) },
        ),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.pago).toMatchObject({
        tipo: 'credito',
        montoRecibido: 0,
        cambio: 0,
      });
      expect(e.modelos.pagoCredito.docs).toHaveLength(1);
      expect(e.modelos.pagoCredito.docs[0]).toMatchObject({ monto_pagar: 200 });
      expect(String(e.modelos.pagoCredito.docs[0].clienteId)).toBe(
        String(cliente._id),
      );
      expect(e.modelos.reportes.docs[0].metodoPago).toBe('credito');
      expect(e.stock(0)).toBe(8);
    });

    it('por transferencia: guarda referencia y banco', async () => {
      const e = crearEntorno();

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 1, cantidad: 4 }], {
          tipo: 'transferencia',
          numeroCuenta: 'TRF-123',
          banco: 'BPA',
        }),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.pago.tipo).toBe('transferencia');
      expect(e.modelos.pagoTransferencia.docs[0]).toMatchObject({
        montoPagar: 200,
        numeroCuenta: 'TRF-123',
        banco: 'BPA',
        metodoPago: 'transferencia',
      });
      expect(e.modelos.reportes.docs[0].metodoPago).toBe('transferencia');
    });

    it('cuenta casa: entrega la mercancía sin cobrar (el reporte suma 0)', async () => {
      const e = crearEntorno();

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], {
          tipo: 'efectivo',
          tipoCliente: 'cliente-cuenta-casa',
        }),
        claveNueva(),
        e.usuario(),
      );

      expect(respuesta.pago).toMatchObject({
        esCuentaCasa: true,
        montoRecibido: 0,
        cambio: 0,
      });
      expect(e.modelos.reportes.docs[0].total).toBe(0);
      expect(e.stock(0)).toBe(9);
    });
  });

  // ─────────────────────────── Stock insuficiente ───────────────────────────
  describe('stock insuficiente', () => {
    it('si falla la segunda línea, devuelve la primera y no deja nada creado', async () => {
      const e = crearEntorno();
      const clave = claveNueva();

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [
            { i: 0, cantidad: 4 },
            { i: 2, cantidad: 7 }, // solo hay 6
          ]),
          clave,
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(400);
      expect(String(cuerpo(fallo).message)).toMatch(
        /Stock insuficiente para "Aceite"/,
      );
      expect(e.stock(0)).toBe(10);
      expect(e.stock(2)).toBe(6);
      nadaCreado(e);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.FALLIDA);
      expect(e.pasos(clave)).toEqual([
        'plan:registrado',
        'stock:iniciado#0',
        'stock:hecho#0',
        'stock:iniciado#1',
        'stock:fallido#1',
        'stock:revirtiendo#0',
        'stock:revertido#0',
        'operacion:fallida',
      ]);
    });

    it('en modo unificado también devuelve a la ubicación de la que salió', async () => {
      const e = crearEntorno({
        unificado: true,
        productos: [
          {
            codigo: 'A',
            nombre: 'Arroz',
            precio: 100,
            stock: 5,
            filas: [
              { contenedor: 1, cantidad: 3 },
              { contenedor: 2, cantidad: 2 },
            ],
          },
          {
            codigo: 'B',
            nombre: 'Frijol',
            precio: 50,
            stock: 1,
            filas: [{ contenedor: 3, cantidad: 1 }],
          },
        ],
      });

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [
            { i: 0, cantidad: 4 },
            { i: 1, cantidad: 2 },
          ]),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(400);
      expect(e.cantidadEn(0, 1)).toBe(3);
      expect(e.cantidadEn(0, 2)).toBe(2);
      expect(e.stock(0)).toBe(5);
      expect(e.sumaExistencias(0)).toBe(5);
      nadaCreado(e);
    });

    it('la misma clave se puede reintentar tras reponer el stock (segundo intento)', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 2, cantidad: 7 }],
        efectivo({ billete1000: 1 }),
      );

      await error(e.checkout.ejecutar(dto, clave, e.usuario()));
      e.modelos.productos.docs[2].stock_inicial = 10;

      const { respuesta, repetida } = await e.checkout.ejecutar(
        dto,
        clave,
        e.usuario(),
      );

      expect(repetida).toBe(false);
      expect(respuesta.comprobante).toBe('V-000001');
      expect(e.stock(2)).toBe(3);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.COMPLETADA);
      expect(e.operacion(clave).intentos).toBe(2);
    });
  });

  // ─────────────────────────── La última unidad ───────────────────────────
  describe('carrera por la última unidad', () => {
    const unaUnidad = [
      { codigo: 'U-1', nombre: 'Última', precio: 100, stock: 1 },
    ];

    it.each([
      ['por producto', false],
      ['por ubicación', true],
    ])(
      'dos cajeros a la vez, una unidad (%s): se vende una sola vez',
      async (_n, unificado) => {
        const e = crearEntorno({ unificado, productos: unaUnidad });

        const resultados = await Promise.allSettled([
          e.checkout.ejecutar(
            dtoCheckout(
              e,
              [{ i: 0, cantidad: 1 }],
              efectivo({ billete100: 1 }),
            ),
            claveNueva(),
            e.usuario('cajero', 'ana'),
          ),
          e.checkout.ejecutar(
            dtoCheckout(
              e,
              [{ i: 0, cantidad: 1 }],
              efectivo({ billete100: 1 }),
            ),
            claveNueva(),
            e.usuario('cajero', 'beto'),
          ),
        ]);

        expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
          1,
        );
        const rechazo = resultados.find(
          (r) => r.status === 'rejected',
        ) as PromiseRejectedResult;
        expect((rechazo.reason as HttpException).getStatus()).toBe(400);
        expect(String((rechazo.reason as HttpException).message)).toMatch(
          /Stock insuficiente/,
        );

        expect(e.stock(0)).toBe(0);
        expect(e.modelos.ventas.docs).toHaveLength(1);
        expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
        expect(e.modelos.kardex.docs).toHaveLength(1);
        expect(e.modelos.reportes.docs).toHaveLength(1);
        if (unificado) expect(e.sumaExistencias(0)).toBe(0);
      },
    );

    it('cinco cajeros y tres unidades: se venden exactamente tres', async () => {
      const e = crearEntorno({
        productos: [{ codigo: 'U-3', nombre: 'Tres', precio: 100, stock: 3 }],
      });

      const resultados = await Promise.allSettled(
        ['a', 'b', 'c', 'd', 'e'].map((n) =>
          e.checkout.ejecutar(
            dtoCheckout(
              e,
              [{ i: 0, cantidad: 1 }],
              efectivo({ billete100: 1 }),
            ),
            claveNueva(),
            e.usuario('cajero', n),
          ),
        ),
      );

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
        3,
      );
      expect(e.stock(0)).toBe(0);
      expect(e.modelos.ventas.docs).toHaveLength(3);
      // Comprobantes distintos entre sí.
      const comprobantes = e.modelos.ventas.docs.map((v) => v.comprobante);
      expect(new Set(comprobantes).size).toBe(3);
    });

    it('dos ventas de varias líneas que se pisan: nunca queda stock negativo ni a medias', async () => {
      const e = crearEntorno({
        productos: [
          { codigo: 'X', nombre: 'X', precio: 10, stock: 5 },
          { codigo: 'Y', nombre: 'Y', precio: 10, stock: 5 },
        ],
      });

      // A pide X y luego Y; B pide Y y luego X: cada una puede quedarse con lo que la otra necesita.
      const resultados = await Promise.allSettled([
        e.checkout.ejecutar(
          dtoCheckout(
            e,
            [
              { i: 0, cantidad: 4 },
              { i: 1, cantidad: 4 },
            ],
            efectivo({ billete100: 1 }),
          ),
          claveNueva(),
          e.usuario('cajero', 'a'),
        ),
        e.checkout.ejecutar(
          dtoCheckout(
            e,
            [
              { i: 1, cantidad: 4 },
              { i: 0, cantidad: 4 },
            ],
            efectivo({ billete100: 1 }),
          ),
          claveNueva(),
          e.usuario('cajero', 'b'),
        ),
      ]);

      const exitos = resultados.filter((r) => r.status === 'fulfilled').length;
      // Como mucho una; puede que ninguna (cada una dejó sin stock a la otra y ambas revirtieron).
      expect(exitos).toBeLessThanOrEqual(1);
      expect(e.stock(0)).toBe(5 - 4 * exitos);
      expect(e.stock(1)).toBe(5 - 4 * exitos);
      expect(e.modelos.ventas.docs).toHaveLength(exitos);
      expect(e.modelos.kardex.docs).toHaveLength(2 * exitos);
    });
  });

  // ─────────────────────────── Idempotencia ───────────────────────────
  describe('idempotencia (Idempotency-Key)', () => {
    it('repetir la misma petición devuelve la misma venta sin vender otra vez', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 0, cantidad: 2 }],
        efectivo({ billete1000: 1 }),
      );

      const primera = await e.checkout.ejecutar(dto, clave, e.usuario());
      const segunda = await e.checkout.ejecutar(dto, clave, e.usuario());
      const tercera = await e.checkout.ejecutar(dto, clave, e.usuario());

      expect(primera.repetida).toBe(false);
      expect(segunda.repetida).toBe(true);
      expect(tercera.repetida).toBe(true);
      expect(segunda.respuesta.venta._id).toBe(primera.respuesta.venta._id);
      expect(segunda.respuesta.pago._id).toBe(primera.respuesta.pago._id);
      expect(segunda.respuesta.comprobante).toBe(primera.respuesta.comprobante);
      expect(segunda.respuesta.idempotencia).toEqual({
        clave,
        estado: 'completada',
        repetida: true,
      });
      expect(segunda.respuesta.venta.total).toBe(primera.respuesta.venta.total);

      // Un solo descuento, una sola venta, un solo pago.
      expect(e.stock(0)).toBe(8);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(e.modelos.kardex.docs).toHaveLength(1);
      expect(e.modelos.reportes.docs).toHaveLength(1);
      expect(e.modelos.contadores.docs[0].seq).toBe(1);
    });

    it('el estimado de pantalla no forma parte de la clave: reintentar con otro estimado es la misma operación', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const base = [{ i: 1, cantidad: 1 }];

      await e.checkout.ejecutar(
        dtoCheckout(e, base, efectivo({ billete50: 1 }), {
          estimado: { total: 50 },
        }),
        clave,
        e.usuario(),
      );
      const otra = await e.checkout.ejecutar(
        dtoCheckout(e, base, efectivo({ billete50: 1 }), {
          estimado: { total: 999 },
        }),
        clave,
        e.usuario(),
      );

      expect(otra.repetida).toBe(true);
      expect(e.modelos.ventas.docs).toHaveLength(1);
    });

    it('la misma clave con otro carrito se rechaza (422) sin tocar nada', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], efectivo({ billete100: 1 })),
        clave,
        e.usuario(),
      );

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 5 }], efectivo({ billete1000: 1 })),
          clave,
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(422);
      expect(e.stock(0)).toBe(9);
      expect(e.modelos.ventas.docs).toHaveLength(1);
    });

    it('la misma clave de otro usuario se rechaza (422)', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 0, cantidad: 1 }],
        efectivo({ billete100: 1 }),
      );
      await e.checkout.ejecutar(dto, clave, e.usuario());

      const otro = { ...e.usuario(), userId: '64b000000000000000000002' };
      const fallo = await error(e.checkout.ejecutar(dto, clave, otro));

      expect(fallo.getStatus()).toBe(422);
    });

    it('dos peticiones simultáneas con la misma clave: una venta y la misma respuesta', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 1, cantidad: 2 }],
        efectivo({ billete100: 1 }),
      );

      const [a, b, c] = await Promise.all([
        e.checkout.ejecutar(dto, clave, e.usuario()),
        e.checkout.ejecutar(dto, clave, e.usuario()),
        e.checkout.ejecutar(dto, clave, e.usuario()),
      ]);

      expect([a, b, c].filter((r) => !r.repetida)).toHaveLength(1);
      expect(new Set([a, b, c].map((r) => r.respuesta.venta._id)).size).toBe(1);
      expect(e.stock(1)).toBe(18);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(e.modelos.kardex.docs).toHaveLength(1);
    });

    it('si la primera sigue en proceso y no termina, el reintento recibe 409 (no vende otra vez)', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 1, cantidad: 1 }],
        efectivo({ billete50: 1 }),
      );
      // La operación original está "viva": en proceso con el arrendamiento vigente.
      const inicio = await e.idem.iniciar({
        clave,
        ambito: 'venta.checkout',
        huella: (
          await import('../../../operacion-idempotente/huella')
        ).huellaDe({ ...dto, estimado: undefined }),
        usuarioId: e.usuario().userId,
      });
      expect(inicio.tipo).toBe('nueva');
      e.idem.esperaMaxMs = 40;

      const fallo = await error(e.checkout.ejecutar(dto, clave, e.usuario()));

      expect(fallo.getStatus()).toBe(409);
      expect(cuerpo(fallo).codigo).toBe('OPERACION_EN_PROCESO');
      expect(e.stock(1)).toBe(20);
    });

    it('una operación en revisión no se reintenta (409)', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 1, cantidad: 1 }],
        efectivo({ billete50: 1 }),
      );
      const huella = (
        await import('../../../operacion-idempotente/huella')
      ).huellaDe({ ...dto, estimado: undefined });
      const inicio = await e.idem.iniciar({
        clave,
        ambito: 'venta.checkout',
        huella,
        usuarioId: e.usuario().userId,
      });
      await e.idem.enviarARevision(
        e.idem.manejador(inicio.operacion),
        'stock dudoso',
      );

      const fallo = await error(e.checkout.ejecutar(dto, clave, e.usuario()));

      expect(fallo.getStatus()).toBe(409);
      expect(cuerpo(fallo).codigo).toBe('OPERACION_EN_REVISION');
      expect(e.stock(1)).toBe(20);
    });

    it.each([
      ['sin clave', undefined],
      ['vacía', '   '],
      ['demasiado corta', 'abc'],
      ['con caracteres no permitidos', 'clave con espacios y ñ'],
      ['demasiado larga', 'x'.repeat(129)],
    ])('la clave %s se rechaza (400)', async (_n, clave) => {
      const e = crearEntorno();

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 1, cantidad: 1 }], efectivo({ billete50: 1 })),
          clave,
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(400);
      expect(String(cuerpo(fallo).message)).toMatch(/Idempotency-Key/);
      expect(e.modelos.operaciones.docs).toHaveLength(0);
    });
  });

  // ─────────────────────────── Descuento por rol ───────────────────────────
  describe('descuento por rol', () => {
    it('hoy todos los roles pueden descontar (como antes), el servidor lo valida', async () => {
      const e = crearEntorno();

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [{ i: 0, cantidad: 1, descuentoPct: 50 }],
          efectivo({ billete100: 1 }),
        ),
        claveNueva(),
        e.usuario('empleado'),
      );

      expect(respuesta.venta.total).toBe(50);
    });

    it('con un tope por rol, un descuento mayor recibe 403 sin tocar nada; dentro del tope se vende', async () => {
      const e = crearEntorno();
      const tabla = DESCUENTO_MAXIMO_POR_ROL as Record<string, number>;
      const original = tabla[UsuarioRol.CAJERO];
      tabla[UsuarioRol.CAJERO] = 10;

      try {
        const fallo = await error(
          e.checkout.ejecutar(
            dtoCheckout(
              e,
              [{ i: 0, cantidad: 1, descuentoPct: 20 }],
              efectivo({ billete100: 1 }),
            ),
            claveNueva(),
            e.usuario('cajero'),
          ),
        );

        expect(fallo.getStatus()).toBe(403);
        expect(String(cuerpo(fallo).message)).toMatch(/hasta 10% de descuento/);
        expect(e.stock(0)).toBe(10);
        nadaCreado(e);

        const dentro = await e.checkout.ejecutar(
          dtoCheckout(
            e,
            [{ i: 0, cantidad: 1, descuentoPct: 10 }],
            efectivo({ billete100: 1 }),
          ),
          claveNueva(),
          e.usuario('cajero'),
        );
        expect(dentro.respuesta.venta.total).toBe(90);

        // El tope es del rol: otro rol no se ve afectado.
        const gerente = await e.checkout.ejecutar(
          dtoCheckout(
            e,
            [{ i: 1, cantidad: 1, descuentoPct: 50 }],
            efectivo({ billete50: 1 }),
          ),
          claveNueva(),
          e.usuario('gerente'),
        );
        expect(gerente.respuesta.venta.total).toBe(25);

        expect(await e.checkout.parametros(e.usuario('cajero'))).toMatchObject({
          descuentoMaximoPct: 10,
        });
      } finally {
        tabla[UsuarioRol.CAJERO] = original;
      }
    });

    it('parametros devuelve el impuesto vigente y el descuento máximo del rol', async () => {
      const e = crearEntorno({ impuesto: 7.5 });

      expect(await e.checkout.parametros(e.usuario('cajero'))).toEqual({
        impuestoPorciento: 7.5,
        descuentoMaximoPct: 100,
      });
    });
  });

  // ─────────────────────────── Fallos al confirmar ───────────────────────────
  describe('fallos al confirmar', () => {
    it('un fallo pasajero al crear el pago se reintenta y la venta sale', async () => {
      const e = crearEntorno();
      let intentos = 0;
      e.modelos.pagoEfectivo.hooks.antes = (op) => {
        if (op === 'create' && ++intentos <= 2)
          throw new Error('timeout de red');
      };

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], efectivo({ billete100: 1 })),
        claveNueva(),
        e.usuario(),
      );

      expect(intentos).toBe(3);
      expect(respuesta.comprobante).toBe('V-000001');
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.stock(0)).toBe(9);
    });

    it('un error al crear la venta que no sea "ya existe" no se da por bueno: 503 y se termina en la recuperación', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 0, cantidad: 1 }],
        efectivo({ billete100: 1 }),
      );
      let fallando = true;
      e.modelos.ventas.hooks.antes = (op) => {
        if (op === 'create' && fallando) throw new Error('índice dañado');
      };

      const fallo = await error(e.checkout.ejecutar(dto, clave, e.usuario()));

      expect(fallo.getStatus()).toBe(503);
      expect(cuerpo(fallo).codigo).toBe('VENTA_PENDIENTE');
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.EN_PROCESO);
      expect(e.modelos.ventas.docs).toHaveLength(0);

      fallando = false;
      e.vencerOperaciones();
      expect(await e.recuperacion.barrer()).toEqual([
        { clave, resultado: 'completada' },
      ]);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.modelos.kardex.docs).toHaveLength(1);
    });

    it('si la confirmación no se logra, la venta NO se revierte: 503 y la completa la recuperación', async () => {
      const e = crearEntorno();
      const clave = claveNueva();
      const dto = dtoCheckout(
        e,
        [{ i: 0, cantidad: 2 }],
        efectivo({ billete1000: 1 }),
      );
      let fallando = true;
      e.modelos.kardex.hooks.antes = (op) => {
        if (op === 'insertMany' && fallando) throw new Error('disco lleno');
      };

      const fallo = await error(e.checkout.ejecutar(dto, clave, e.usuario()));

      expect(fallo.getStatus()).toBe(503);
      expect(cuerpo(fallo).codigo).toBe('VENTA_PENDIENTE');
      // Cobrado y descontado: no se devolvió nada.
      expect(e.stock(0)).toBe(8);
      expect(e.operacion(clave)).toMatchObject({
        estado: EstadoOperacion.EN_PROCESO,
        confirmando: true,
      });
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.modelos.kardex.docs).toHaveLength(0);

      // El problema se resuelve; la recuperación (tras vencer el arrendamiento) termina la venta.
      fallando = false;
      e.vencerOperaciones();
      const informes = await e.recuperacion.barrer();

      expect(informes).toEqual([{ clave, resultado: 'completada' }]);
      expect(e.modelos.ventas.docs).toHaveLength(1);
      expect(e.modelos.kardex.docs).toHaveLength(1);
      expect(e.modelos.reportes.docs).toHaveLength(1);
      expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
      expect(e.stock(0)).toBe(8);

      // Y el reintento del cajero recibe la venta, sin repetirla.
      const reintento = await e.checkout.ejecutar(dto, clave, e.usuario());
      expect(reintento.repetida).toBe(true);
      expect(reintento.respuesta.comprobante).toBe('V-000001');
      expect(e.modelos.ventas.docs).toHaveLength(1);
    });
  });
});
