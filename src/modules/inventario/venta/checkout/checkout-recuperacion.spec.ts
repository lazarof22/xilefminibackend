/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { HttpException } from '@nestjs/common';
import { EstadoOperacion } from '../../../operacion-idempotente/schema/operacion-idempotente.schema';
import { Doc, FakeModel } from '../../exitencia/fake-mongo-spec';
import {
  claveNueva,
  crearEntorno,
  dtoCheckout,
  efectivo,
  Entorno,
  silenciarLogs,
} from './checkout-entorno-spec';

/**
 * Caídas del servidor en cada paso de una venta (MongoDB autónomo: sin
 * transacciones). Se simula matando el "proceso" (`interruptor.caido`) justo
 * antes o justo después de una escritura concreta; luego se "reinicia" (servicios
 * nuevos sobre la misma base), vence el arrendamiento y corre la recuperación.
 *
 * Venta de 2 líneas, impuesto 10 %: Arroz ×2 (100) + Frijol ×3 (50) = 385.
 * Escrituras en orden (modo por producto):
 *   op.create · op.plan · [op.iniciado#0 · producto#0 · op.hecho#0] ·
 *   [op.iniciado#1 · producto#1 · op.hecho#1] · contador · op.confirmando ·
 *   pago · venta · kardex · reporte · op.completada
 */

type Cuando = (op: string, datos: Doc) => boolean;

/** El asiento del registro de pasos que escribe esa actualización. */
const asiento =
  (paso: string, evento: string, linea?: number): Cuando =>
  (_op, datos) => {
    const p = datos.update?.$push?.pasos;
    return (
      !!p &&
      p.paso === paso &&
      p.evento === evento &&
      (linea === undefined || p.linea === linea)
    );
  };

const confirmando: Cuando = (_op, datos) =>
  datos.update?.$set?.confirmando === true;
const completada: Cuando = (_op, datos) =>
  datos.update?.$set?.estado === EstadoOperacion.COMPLETADA;
const creacion: Cuando = (op) => op === 'create';
const insercionMultiple: Cuando = (op) => op === 'insertMany';

/** Deja caído el proceso en la `n`-ésima escritura que cumpla `cuando`. */
function caerEn(
  e: Entorno,
  modelo: FakeModel,
  fase: 'antes' | 'despues',
  cuando: Cuando,
  n = 1,
): void {
  let cuenta = 0;
  modelo.hooks[fase] = (op, datos) => {
    if (cuando(op, datos) && ++cuenta === n) e.interruptor.caido = true;
  };
}

const limpiarHooks = (e: Entorno): void => {
  for (const modelo of Object.values(e.modelos)) modelo.hooks = {};
};

/** Ejecuta la venta hasta que el proceso cae; devuelve el error que vio el cajero. */
async function ejecutarHastaLaCaida(
  e: Entorno,
  clave: string,
  dto = ventaDeDosLineas(e),
): Promise<void> {
  await expect(e.checkout.ejecutar(dto, clave, e.usuario())).rejects.toThrow(
    /Proceso caído/,
  );
  expect(e.interruptor.caido).toBe(true);
}

/**
 * Ejecuta una venta que ya estaba fallando por falta de stock y cae el proceso
 * mientras devuelve lo reservado. Quien cobra recibe el aviso de "quedó en
 * revisión" (no pudo ni devolver el stock ni anotarlo); lo que la base dice de
 * verdad lo decide la recuperación al reiniciar.
 */
async function esperarFalloPorCaida(
  e: Entorno,
  dto: ReturnType<typeof ventaDeDosLineas>,
  clave: string,
): Promise<void> {
  const fallo = await e.checkout.ejecutar(dto, clave, e.usuario()).then(
    () => undefined,
    (x: unknown) => x,
  );

  expect(e.interruptor.caido).toBe(true);
  expect(fallo).toBeInstanceOf(HttpException);
  expect((fallo as HttpException).getResponse()).toMatchObject({
    codigo: 'OPERACION_EN_REVISION',
  });
}

const ventaDeDosLineas = (e: Entorno) =>
  dtoCheckout(
    e,
    [
      { i: 0, cantidad: 2 },
      { i: 1, cantidad: 3 },
    ],
    efectivo({ billete1000: 1 }),
  );

/** Reinicio del servidor + vence el arrendamiento + corre la recuperación. */
async function recuperar(e: Entorno) {
  limpiarHooks(e);
  e.reiniciar();
  e.vencerOperaciones();
  return e.recuperacion.barrer();
}

function ventaCompleta(e: Entorno): void {
  expect(e.modelos.ventas.docs).toHaveLength(1);
  expect(e.modelos.pagoEfectivo.docs).toHaveLength(1);
  expect(e.modelos.kardex.docs).toHaveLength(2);
  expect(e.modelos.reportes.docs).toHaveLength(2);
  expect(e.stock(0)).toBe(8);
  expect(e.stock(1)).toBe(17);
}

function nadaVendido(e: Entorno): void {
  expect(e.modelos.ventas.docs).toHaveLength(0);
  expect(e.modelos.pagoEfectivo.docs).toHaveLength(0);
  expect(e.modelos.kardex.docs).toHaveLength(0);
  expect(e.modelos.reportes.docs).toHaveLength(0);
}

const stockIntacto = (e: Entorno): void => {
  expect(e.stock(0)).toBe(10);
  expect(e.stock(1)).toBe(20);
};

describe('Recuperación del checkout tras una caída del servidor', () => {
  let restaurar: () => void;

  beforeEach(() => {
    restaurar = silenciarLogs();
  });
  afterEach(() => restaurar());

  // ─────────────── Antes del punto de no retorno: se deshace ───────────────
  describe('antes de confirmar: se devuelve el stock y la venta se puede reintentar', () => {
    it('caída tras crear la operación, antes de guardar el plan: no había tocado nada', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.operaciones, 'despues', creacion);

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'sin_plan' }]);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.FALLIDA);
      stockIntacto(e);
      nadaVendido(e);
    });

    it('caída con el plan guardado y el stock sin tocar: revertida sin devolver nada', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(
        e,
        e.modelos.operaciones,
        'despues',
        asiento('plan', 'registrado'),
      );

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revertida' }]);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.FALLIDA);
      stockIntacto(e);
      nadaVendido(e);
    });

    it('caída con la línea 0 descontada y anotada: se devuelve esa línea', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.operaciones, 'despues', asiento('stock', 'hecho', 0));

      await ejecutarHastaLaCaida(e, clave);
      expect(e.stock(0)).toBe(8); // quedó descontado
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revertida' }]);
      stockIntacto(e);
      nadaVendido(e);
      expect(e.pasos(clave).slice(-3)).toEqual([
        'stock:revirtiendo#0',
        'stock:revertido#0',
        'operacion:fallida',
      ]);
    });

    it('caída con las dos líneas descontadas, antes del comprobante: se devuelven las dos', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.operaciones, 'despues', asiento('stock', 'hecho', 1));

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revertida' }]);
      stockIntacto(e);
      nadaVendido(e);
    });

    it('caída tras tomar el número de comprobante: se devuelve el stock (el número se pierde)', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.contadores, 'despues', () => true);

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revertida' }]);
      stockIntacto(e);
      nadaVendido(e);

      // El reintento con la misma clave vende y no repite número de comprobante.
      const { respuesta } = await e.checkout.ejecutar(
        ventaDeDosLineas(e),
        clave,
        e.usuario(),
      );
      expect(respuesta.comprobante).toBe('V-000002');
      ventaCompleta(e);
    });

    it('tras revertir, reintentar con la misma clave ejecuta la venta (segundo intento) una sola vez', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.operaciones, 'despues', asiento('stock', 'hecho', 0));
      await ejecutarHastaLaCaida(e, clave);
      await recuperar(e);

      const reintento = await e.checkout.ejecutar(
        ventaDeDosLineas(e),
        clave,
        e.usuario(),
      );
      const otro = await e.checkout.ejecutar(
        ventaDeDosLineas(e),
        clave,
        e.usuario(),
      );

      expect(reintento.repetida).toBe(false);
      expect(otro.repetida).toBe(true);
      expect(e.operacion(clave).intentos).toBe(2);
      ventaCompleta(e);
    });
  });

  // ─────────────── Lo dudoso: no se toca el stock a ciegas ───────────────
  describe('cuando no se sabe si una escritura llegó a hacerse: revisión, sin tocar el stock', () => {
    it('anotado "voy a descontar" y la caída llegó antes del descuento', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.productos, 'antes', () => true);

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revision' }]);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.REVISION);
      expect(e.operacion(clave).motivoRevision).toMatch(/línea 1 \(Arroz x2\)/);
      stockIntacto(e); // no se descontó y la recuperación no inventó nada
      nadaVendido(e);
    });

    it('el descuento se aplicó pero no llegó a anotarse: revisión y el stock sigue descontado', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.productos, 'despues', () => true);

      await ejecutarHastaLaCaida(e, clave);
      expect(e.stock(0)).toBe(8);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revision' }]);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.REVISION);
      // La recuperación NO devolvió ni descontó nada más.
      expect(e.stock(0)).toBe(8);
      expect(e.stock(1)).toBe(20);
      nadaVendido(e);
    });

    it('en la segunda línea: devuelve la primera (segura) y deja la segunda en revisión', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.productos, 'despues', () => true, 2);

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revision' }]);
      expect(e.stock(0)).toBe(10); // la línea 0 sí estaba anotada: se devolvió
      expect(e.stock(1)).toBe(17); // la línea 1 es dudosa: se deja como está
      expect(e.operacion(clave).motivoRevision).toMatch(
        /línea 2 \(Frijol x3\)/,
      );
      expect(e.operacion(clave).motivoRevision).not.toMatch(/línea 1/);
    });

    it('una operación en revisión no se reintenta: 409 hasta que una persona la resuelva', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.productos, 'despues', () => true);
      await ejecutarHastaLaCaida(e, clave);
      await recuperar(e);

      const fallo = await e.checkout
        .ejecutar(ventaDeDosLineas(e), clave, e.usuario())
        .catch((x: HttpException) => x);

      expect((fallo as HttpException).getStatus()).toBe(409);
      expect((fallo as HttpException).getResponse()).toMatchObject({
        codigo: 'OPERACION_EN_REVISION',
      });
    });
  });

  // ─────────────── Caída a mitad de la devolución ───────────────
  describe('caída mientras se devolvía el stock tras un fallo', () => {
    /** Línea 0 se descuenta; la 1 no tiene stock y obliga a devolver la 0. */
    const conFaltaDeStock = () =>
      crearEntorno({
        impuesto: 10,
        productos: [
          { codigo: 'A', nombre: 'Arroz', precio: 100, stock: 10 },
          { codigo: 'B', nombre: 'Frijol', precio: 50, stock: 1 },
        ],
      });
    const dto = (e: Entorno) =>
      dtoCheckout(
        e,
        [
          { i: 0, cantidad: 2 },
          { i: 1, cantidad: 3 },
        ],
        efectivo({ billete1000: 1 }),
      );

    it('anotado "voy a devolver" y la caída llegó antes de devolver: revisión (el stock sigue descontado)', async () => {
      const e = conFaltaDeStock();
      const clave = claveNueva();
      caerEn(
        e,
        e.modelos.operaciones,
        'despues',
        asiento('stock', 'revirtiendo', 0),
      );

      await esperarFalloPorCaida(e, dto(e), clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revision' }]);
      expect(e.stock(0)).toBe(8);
    });

    it('la devolución se aplicó pero no se anotó: revisión y NO se devuelve dos veces', async () => {
      const e = conFaltaDeStock();
      const clave = claveNueva();
      // La devolución es la 2.ª escritura en productos (la 1.ª fue el descuento de la línea 0).
      caerEn(e, e.modelos.productos, 'despues', () => true, 2);

      await esperarFalloPorCaida(e, dto(e), clave);
      expect(e.stock(0)).toBe(10); // ya devuelto
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revision' }]);
      expect(e.stock(0)).toBe(10); // sigue en 10, no 12
    });

    it('devuelto y anotado, caída antes de marcar la operación como fallida: se cierra sin tocar el stock', async () => {
      const e = conFaltaDeStock();
      const clave = claveNueva();
      caerEn(
        e,
        e.modelos.operaciones,
        'despues',
        asiento('stock', 'revertido', 0),
      );

      await esperarFalloPorCaida(e, dto(e), clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'revertida' }]);
      expect(e.stock(0)).toBe(10);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.FALLIDA);
    });
  });

  // ─────────────── Desde el punto de no retorno: se termina ───────────────
  describe('después de confirmar: la venta se termina, sin duplicar nada', () => {
    it.each([
      [
        'justo al marcar la confirmación',
        (e: Entorno) =>
          caerEn(e, e.modelos.operaciones, 'despues', confirmando),
      ],
      [
        'antes de crear el pago',
        (e: Entorno) => caerEn(e, e.modelos.pagoEfectivo, 'antes', creacion),
      ],
      [
        'con el pago creado',
        (e: Entorno) => caerEn(e, e.modelos.pagoEfectivo, 'despues', creacion),
      ],
      [
        'con la venta creada',
        (e: Entorno) => caerEn(e, e.modelos.ventas, 'despues', creacion),
      ],
      [
        'con el Kardex escrito',
        (e: Entorno) =>
          caerEn(e, e.modelos.kardex, 'despues', insercionMultiple),
      ],
      [
        'con el Reporte Plus escrito',
        (e: Entorno) =>
          caerEn(e, e.modelos.reportes, 'despues', insercionMultiple),
      ],
      [
        'antes de marcar la operación como completada',
        (e: Entorno) => caerEn(e, e.modelos.operaciones, 'antes', completada),
      ],
    ])('caída %s', async (_nombre, preparar) => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      preparar(e);

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'completada' }]);
      ventaCompleta(e);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.COMPLETADA);
      expect(e.operacion(clave).respuesta.comprobante).toBe('V-000001');
      // Sigue siendo la misma venta: un reintento del cajero la recibe tal cual.
      const reintento = await e.checkout.ejecutar(
        ventaDeDosLineas(e),
        clave,
        e.usuario(),
      );
      expect(reintento.repetida).toBe(true);
      expect(reintento.respuesta.venta._id).toBe(
        String(e.modelos.ventas.docs[0]._id),
      );
      ventaCompleta(e);
    });

    it('caída con la operación ya completada (se perdió solo la respuesta): nada que recuperar', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.operaciones, 'despues', completada);

      await ejecutarHastaLaCaida(e, clave);
      const informes = await recuperar(e);

      expect(informes).toEqual([]);
      ventaCompleta(e);
      const reintento = await e.checkout.ejecutar(
        ventaDeDosLineas(e),
        clave,
        e.usuario(),
      );
      expect(reintento.repetida).toBe(true);
    });

    it('un lote de Kardex que quedó a medias se completa sin duplicar lo ya escrito', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.kardex, 'antes', insercionMultiple);
      await ejecutarHastaLaCaida(e, clave);

      // Como en MongoDB real: llegó a escribirse el primer asiento del lote.
      const plan = e.operacion(clave).plan;
      e.modelos.kardex.insertar({
        _id: plan.lineas[0].kardexId,
        tipo: 'venta',
        cantidad: 2,
        stock: 8,
      });

      const informes = await recuperar(e);

      expect(informes).toEqual([{ clave, resultado: 'completada' }]);
      expect(e.modelos.kardex.docs).toHaveLength(2);
      ventaCompleta(e);
    });

    it('recuperar dos veces no repite nada', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.ventas, 'despues', creacion);
      await ejecutarHastaLaCaida(e, clave);

      await recuperar(e);
      e.vencerOperaciones();
      const segundo = await e.recuperacion.barrer();

      expect(segundo).toEqual([]);
      ventaCompleta(e);
    });

    it('dos servidores recuperando a la vez: solo uno se queda con la operación', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.ventas, 'despues', creacion);
      await ejecutarHastaLaCaida(e, clave);
      limpiarHooks(e);
      e.reiniciar();
      e.vencerOperaciones();
      const otro = e.reiniciar(); // un segundo "servidor" sobre la misma base

      const [a, b] = await Promise.all([
        e.recuperacion.barrer(),
        otro.recuperacion.barrer(),
      ]);

      expect([...a, ...b]).toEqual([{ clave, resultado: 'completada' }]);
      ventaCompleta(e);
    });

    it('si la recuperación tampoco puede terminar, reintenta y al final pasa a revisión', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.operaciones, 'despues', confirmando);
      await ejecutarHastaLaCaida(e, clave);
      limpiarHooks(e);
      e.reiniciar();
      // El Kardex no se puede escribir (por ejemplo, disco lleno) en ningún intento.
      e.modelos.kardex.hooks.antes = (op) => {
        if (op === 'insertMany') throw new Error('disco lleno');
      };

      const resultados: string[] = [];
      for (let i = 0; i < 7; i++) {
        e.vencerOperaciones();
        resultados.push(
          ...(await e.recuperacion.barrer()).map((x) => x.resultado),
        );
      }

      expect(resultados).toEqual([
        'pendiente',
        'pendiente',
        'pendiente',
        'pendiente',
        'pendiente',
        'revision',
      ]);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.REVISION);
      expect(e.operacion(clave).motivoRevision).toMatch(
        /intentos de recuperación/,
      );
    });

    it('lo que sigue vigente (su arrendamiento no venció) no se toca', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      caerEn(e, e.modelos.ventas, 'despues', creacion);
      await ejecutarHastaLaCaida(e, clave);
      limpiarHooks(e);
      e.reiniciar();

      const informes = await e.recuperacion.barrer(); // sin vencer

      expect(informes).toEqual([]);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.EN_PROCESO);
    });
  });

  // ─────────────── El proceso "zombie" ───────────────
  describe('un proceso lento al que la recuperación le quitó la operación', () => {
    it('al despertar no sigue escribiendo: recibe 409 y la venta queda hecha una sola vez', async () => {
      const e = crearEntorno({ impuesto: 10 });
      const clave = claveNueva();
      const dto = ventaDeDosLineas(e);

      // El proceso se queda "dormido" justo al escribir el Reporte Plus.
      let despertar!: () => void;
      let dormido!: () => void;
      const pausa = new Promise<void>((resolver) => (despertar = resolver));
      const aviso = new Promise<void>((resolver) => (dormido = resolver));
      const insertManyOriginal = e.modelos.reportes.insertMany.bind(
        e.modelos.reportes,
      );
      let llamadas = 0;
      e.modelos.reportes.insertMany = async (
        ...args: Parameters<FakeModel['insertMany']>
      ) => {
        // Solo la primera llamada (la del proceso lento) se duerme.
        if (++llamadas === 1) {
          dormido();
          await pausa;
        }
        return insertManyOriginal(...args);
      };

      const original = e.checkout.ejecutar(dto, clave, e.usuario());
      const resultadoOriginal = original.then(
        () => 'ok' as const,
        (x: HttpException) => x,
      );
      await aviso;

      // Mientras tanto, otro servidor (o este mismo, ya reiniciado) toma la operación vencida.
      e.vencerOperaciones();
      const otro = e.reiniciar();
      const informes = await otro.recuperacion.barrer();
      expect(informes).toEqual([{ clave, resultado: 'completada' }]);

      // El proceso lento despierta y sigue con lo suyo.
      despertar();
      const fin = await resultadoOriginal;

      expect(fin).not.toBe('ok');
      expect((fin as HttpException).getStatus()).toBe(409);
      expect((fin as HttpException).getResponse()).toMatchObject({
        codigo: 'OPERACION_TOMADA',
      });
      ventaCompleta(e);
      expect(e.operacion(clave).estado).toBe(EstadoOperacion.COMPLETADA);
      expect(e.modelos.contadores.docs[0].seq).toBe(1);
    });
  });
});
