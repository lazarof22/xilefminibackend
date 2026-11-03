/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExistenciaService } from './existencia.service';
import { StockInsuficienteException } from './stock-insuficiente.exception';
import { FakeModel } from './fake-mongo-spec';

/**
 * Pruebas del saldo unificado (Fase 1) con modelos en memoria
 * (`fake-mongo-spec.ts`). Las llamadas simultáneas se entrelazan como lo
 * harían dos cajeros reales: lecturas primero, escrituras después.
 *
 * Escenario base — producto "Arroz" con 10 unidades y ubicación por defecto
 * Central / Estante 1:
 *   Central: Estante 1 = 6, Estante 2 = 3      Tienda: Vitrina = 1
 */

interface Cantidades {
  c1?: number;
  c2?: number;
  c3?: number;
}

function escenario(
  cantidades: Cantidades = { c1: 6, c2: 3, c3: 1 },
  stock?: number,
) {
  const almacenes = new FakeModel([
    { nombreAlmacen: 'Central' },
    { nombreAlmacen: 'Tienda' },
  ]);
  const [A1, A2] = almacenes.docs.map((d) => d._id as Types.ObjectId);

  const contenedores = new FakeModel([
    { nombreContenedor: 'Estante 1', almacen: A1 },
    { nombreContenedor: 'Estante 2', almacen: A1 },
    { nombreContenedor: 'Vitrina', almacen: A2 },
  ]);
  const [C1, C2, C3] = contenedores.docs.map((d) => d._id as Types.ObjectId);

  const suma =
    (cantidades.c1 ?? 0) + (cantidades.c2 ?? 0) + (cantidades.c3 ?? 0);
  const productos = new FakeModel([
    {
      codigo_producto: 'ARR-1',
      nombre_producto: 'Arroz',
      stock_inicial: stock ?? suma,
      almacen: A1,
      contenedor: C1,
    },
  ]);
  const P = productos.docs[0]._id as Types.ObjectId;

  const existencias = new FakeModel();
  const filas: [Types.ObjectId, Types.ObjectId, number | undefined][] = [
    [A1, C1, cantidades.c1],
    [A1, C2, cantidades.c2],
    [A2, C3, cantidades.c3],
  ];
  for (const [almacen, contenedor, cantidad] of filas) {
    if (cantidad !== undefined) {
      existencias.insertar({ producto: P, almacen, contenedor, cantidad });
    }
  }

  const config = new FakeModel();
  const servicio = new ExistenciaService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    config as never,
  );

  return {
    servicio,
    existencias,
    productos,
    almacenes,
    contenedores,
    config,
    A1,
    A2,
    C1,
    C2,
    C3,
    P,
    /** Cantidad de una ubicación (undefined si no tiene fila). */
    cantidad: (contenedor: Types.ObjectId): number | undefined => {
      const fila = existencias.docs.find(
        (d) => String(d.contenedor) === String(contenedor),
      );
      return fila ? Number(fila.cantidad) : undefined;
    },
    /** Total sincronizado del producto base. */
    stock: (): number => Number(productos.docs[0].stock_inicial),
    /** Σ de las existencias del producto base. */
    suma: (): number =>
      existencias.docs
        .filter((d) => String(d.producto) === String(P))
        .reduce((s, d) => s + Number(d.cantidad), 0),
  };
}

const ubicaciones = (
  lista: { contenedor: Types.ObjectId; cantidad: number }[],
): string[] => lista.map((u) => `${String(u.contenedor)}:${u.cantidad}`);

describe('ExistenciaService — saldo unificado (Fase 1)', () => {
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Compuerta ─────────────────────────────────────────────────────
  describe('compuerta de unificación', () => {
    it('por defecto el modo unificado está apagado', async () => {
      const { servicio } = escenario();

      expect(await servicio.estaUnificado()).toBe(false);
      expect(await servicio.obtenerEstadoUnificacion()).toEqual({
        unificado: false,
        unificadoEn: undefined,
        unificadoPor: undefined,
      });
    });

    it('activarModoUnificado lo enciende y registra quién y cuándo', async () => {
      const { servicio, config } = escenario();

      await servicio.activarModoUnificado('admin');

      expect(await servicio.estaUnificado()).toBe(true);
      const estado = await servicio.obtenerEstadoUnificacion();
      expect(estado.unificado).toBe(true);
      expect(estado.unificadoPor).toBe('admin');
      expect(estado.unificadoEn).toBeInstanceOf(Date);
      expect(config.docs).toHaveLength(1);
      expect(config.docs[0].clave).toBe('inventario');
    });

    it('activarlo dos veces no duplica la configuración', async () => {
      const { servicio, config } = escenario();

      await servicio.activarModoUnificado('admin');
      await servicio.activarModoUnificado('otro');

      expect(config.docs).toHaveLength(1);
    });
  });

  // ─── descontarProducto ─────────────────────────────────────────────
  describe('descontarProducto', () => {
    it('descuenta primero de la ubicación por defecto del producto', async () => {
      const e = escenario();

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 4,
      });

      expect(ubicaciones(r.ubicaciones)).toEqual([`${String(e.C1)}:4`]);
      expect(r.stockTotal).toBe(6);
      expect(e.cantidad(e.C1)).toBe(2);
      expect(e.cantidad(e.C2)).toBe(3);
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(6);
    });

    it('acepta el id como texto', async () => {
      const e = escenario();

      await e.servicio.descontarProducto({
        productoId: String(e.P),
        cantidad: 1,
      });

      expect(e.cantidad(e.C1)).toBe(5);
    });

    it('reparte entre ubicaciones: por defecto primero y luego la de más stock', async () => {
      const e = escenario();

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 8,
      });

      expect(ubicaciones(r.ubicaciones)).toEqual([
        `${String(e.C1)}:6`,
        `${String(e.C2)}:2`,
      ]);
      expect(r.stockTotal).toBe(2);
      expect(e.cantidad(e.C1)).toBe(0);
      expect(e.cantidad(e.C2)).toBe(1);
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(e.suma());
    });

    it('puede vender todo el stock del producto', async () => {
      const e = escenario();

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 10,
      });

      expect(r.stockTotal).toBe(0);
      expect(e.suma()).toBe(0);
      expect(e.stock()).toBe(0);
    });

    it('ignora las ubicaciones agotadas', async () => {
      const e = escenario({ c1: 0, c2: 5, c3: 0 });

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 2,
      });

      expect(ubicaciones(r.ubicaciones)).toEqual([`${String(e.C2)}:2`]);
    });

    it('con ubicación indicada solo toma de esa ubicación', async () => {
      const e = escenario();

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 1,
        almacenId: e.A2,
        contenedorId: e.C3,
      });

      expect(ubicaciones(r.ubicaciones)).toEqual([`${String(e.C3)}:1`]);
      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.cantidad(e.C3)).toBe(0);
      expect(e.stock()).toBe(9);
    });

    it('con solo el almacén indicado reparte dentro de ese almacén', async () => {
      const e = escenario();

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 8,
        almacenId: e.A1,
      });

      expect(ubicaciones(r.ubicaciones)).toEqual([
        `${String(e.C1)}:6`,
        `${String(e.C2)}:2`,
      ]);
      expect(e.cantidad(e.C3)).toBe(1);
    });

    it('si la ubicación indicada no alcanza, rechaza sin tocar nada', async () => {
      const e = escenario();

      const intento = e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 2,
        almacenId: e.A2,
        contenedorId: e.C3,
      });

      await expect(intento).rejects.toBeInstanceOf(StockInsuficienteException);
      await expect(intento).rejects.toThrow(
        'Stock insuficiente para "Arroz" en la ubicación indicada: disponible 1, solicitado 2',
      );
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(10);
    });

    it('si el total no alcanza, rechaza sin tocar nada', async () => {
      const e = escenario();

      const intento = e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 11,
      });

      await expect(intento).rejects.toBeInstanceOf(StockInsuficienteException);
      await expect(intento).rejects.toThrow(
        'Stock insuficiente para "Arroz": disponible 10, solicitado 11',
      );
      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.cantidad(e.C2)).toBe(3);
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(10);
    });

    it('admite cantidades fraccionarias', async () => {
      const e = escenario();

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 0.5,
      });

      expect(e.cantidad(e.C1)).toBe(5.5);
      expect(r.stockTotal).toBe(9.5);
    });

    it('vende el saldo completo aunque la fracción guardada tenga residuo binario', async () => {
      // 0.7 − 0.4 = 0.29999999999999993: debe poder venderse "los 0.3 que quedan".
      const e = escenario({ c1: 0.7 - 0.4 });

      const r = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 0.3,
      });

      expect(r.stockTotal).toBe(0);
      expect(Math.abs(e.cantidad(e.C1) as number)).toBeLessThan(1e-6);
    });

    describe('ventas simultáneas', () => {
      it('dos cajeros que venden la última unidad: solo uno la vende', async () => {
        const e = escenario({ c1: 1 });

        const resultados = await Promise.allSettled([
          e.servicio.descontarProducto({ productoId: e.P, cantidad: 1 }),
          e.servicio.descontarProducto({ productoId: e.P, cantidad: 1 }),
        ]);

        expect(resultados.map((r) => r.status).sort()).toEqual([
          'fulfilled',
          'rejected',
        ]);
        const rechazada = resultados.find(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        expect(rechazada?.reason).toBeInstanceOf(StockInsuficienteException);
        expect(e.cantidad(e.C1)).toBe(0);
        expect(e.stock()).toBe(0);
      });

      it('diez ventas de 1 unidad con 5 en stock: se venden exactamente 5', async () => {
        const e = escenario({ c1: 5 });

        const resultados = await Promise.allSettled(
          Array.from({ length: 10 }, () =>
            e.servicio.descontarProducto({ productoId: e.P, cantidad: 1 }),
          ),
        );

        expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
          5,
        );
        expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(
          5,
        );
        expect(e.cantidad(e.C1)).toBe(0);
        expect(e.stock()).toBe(0);
      });

      it('con varias ubicaciones y demanda mayor que el stock nunca vende de más ni pierde unidades', async () => {
        const e = escenario({ c1: 3, c2: 3 });

        const resultados = await Promise.allSettled(
          Array.from({ length: 4 }, () =>
            e.servicio.descontarProducto({ productoId: e.P, cantidad: 2 }),
          ),
        );

        const vendidas =
          resultados.filter((r) => r.status === 'fulfilled').length * 2;

        expect(vendidas).toBeLessThanOrEqual(6);
        expect(e.cantidad(e.C1)).toBeGreaterThanOrEqual(0);
        expect(e.cantidad(e.C2)).toBeGreaterThanOrEqual(0);
        // Lo que no se vendió sigue en las ubicaciones; el total sincronizado coincide.
        expect(e.suma() + vendidas).toBe(6);
        expect(e.stock()).toBe(e.suma());
        for (const r of resultados) {
          if (r.status === 'rejected') {
            expect(r.reason).toBeInstanceOf(StockInsuficienteException);
          }
        }
      });

      it('si otro cajero vacía una ubicación a mitad, relee y reparte lo que falta', async () => {
        const e = escenario({ c1: 1, c2: 2 });
        // Justo antes de la primera escritura, otro cajero vende la unidad de Estante 1.
        e.existencias.hooks.antesDeEscribir = (n) => {
          if (n === 1) {
            e.existencias.docs[0].cantidad = 0;
            e.productos.docs[0].stock_inicial -= 1;
          }
        };

        const r = await e.servicio.descontarProducto({
          productoId: e.P,
          cantidad: 2,
        });

        expect(ubicaciones(r.ubicaciones)).toEqual([`${String(e.C2)}:2`]);
        expect(e.cantidad(e.C1)).toBe(0);
        expect(e.cantidad(e.C2)).toBe(0);
        expect(e.stock()).toBe(0);
        expect(r.stockTotal).toBe(0);
      });

      it('si otro cajero se lleva el resto, devuelve lo ya descontado y avisa lo que queda', async () => {
        const e = escenario({ c1: 1, c2: 1 });
        // Otro cajero vende la unidad de Estante 2 antes de que lo hagamos nosotros.
        e.existencias.hooks.antesDeEscribir = (n) => {
          if (n === 1) {
            e.existencias.docs[1].cantidad = 0;
            e.productos.docs[0].stock_inicial -= 1;
          }
        };

        const intento = e.servicio.descontarProducto({
          productoId: e.P,
          cantidad: 2,
        });

        await expect(intento).rejects.toThrow(
          'Stock insuficiente para "Arroz": disponible 1, solicitado 2',
        );
        // Estante 1 vuelve a tener su unidad; el resto es del otro cajero.
        expect(e.cantidad(e.C1)).toBe(1);
        expect(e.cantidad(e.C2)).toBe(0);
        expect(e.stock()).toBe(1);
      });
    });

    describe('fallos de la base de datos', () => {
      it('ante un error de escritura devuelve lo anterior y lo deja en el log', async () => {
        const e = escenario({ c1: 2, c2: 2 });
        e.existencias.fallarSi = () =>
          e.existencias.escrituras === 2 ? new Error('timeout') : undefined;

        const intento = e.servicio.descontarProducto({
          productoId: e.P,
          cantidad: 3,
        });

        await expect(intento).rejects.toThrow('timeout');
        expect(e.cantidad(e.C1)).toBe(2); // la primera escritura se compensó
        expect(e.cantidad(e.C2)).toBe(2);
        expect(e.stock()).toBe(4);
        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining('ambiguo'),
        );
      });

      it('si falla el total sincronizado del producto, devuelve las ubicaciones', async () => {
        const e = escenario();
        e.productos.fallarSi = (_filtro, update) =>
          update.$inc ? new Error('boom') : undefined;

        const intento = e.servicio.descontarProducto({
          productoId: e.P,
          cantidad: 8,
        });

        await expect(intento).rejects.toThrow('boom');
        expect(e.cantidad(e.C1)).toBe(6);
        expect(e.cantidad(e.C2)).toBe(3);
        expect(e.cantidad(e.C3)).toBe(1);
      });
    });

    describe('validaciones', () => {
      it('rechaza un id de producto inválido', async () => {
        const e = escenario();

        await expect(
          e.servicio.descontarProducto({ productoId: 'no-es-id', cantidad: 1 }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rechaza la cantidad %s',
        async (cantidad) => {
          const e = escenario();

          await expect(
            e.servicio.descontarProducto({ productoId: e.P, cantidad }),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(e.stock()).toBe(10);
        },
      );

      it('rechaza un producto que no existe', async () => {
        const e = escenario();

        await expect(
          e.servicio.descontarProducto({
            productoId: new Types.ObjectId(),
            cantidad: 1,
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('rechaza un id de almacén inválido', async () => {
        const e = escenario();

        await expect(
          e.servicio.descontarProducto({
            productoId: e.P,
            cantidad: 1,
            almacenId: 'xx',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });

  // ─── reponerProducto ───────────────────────────────────────────────
  describe('reponerProducto', () => {
    it('con ubicaciones devuelve exactamente a cada una lo que salió', async () => {
      const e = escenario();

      const r = await e.servicio.reponerProducto({
        productoId: e.P,
        ubicaciones: [
          { almacen: e.A1, contenedor: e.C1, cantidad: 2 },
          { almacen: e.A1, contenedor: e.C2, cantidad: 1 },
        ],
      });

      expect(e.cantidad(e.C1)).toBe(8);
      expect(e.cantidad(e.C2)).toBe(4);
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(13);
      expect(r.stockTotal).toBe(13);
      expect(ubicaciones(r.ubicaciones)).toEqual([
        `${String(e.C1)}:2`,
        `${String(e.C2)}:1`,
      ]);
    });

    it('descontar y reponer con lo devuelto deja todo como estaba', async () => {
      const e = escenario();

      const salida = await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 8,
      });
      await e.servicio.reponerProducto({
        productoId: e.P,
        ubicaciones: salida.ubicaciones,
      });

      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.cantidad(e.C2)).toBe(3);
      expect(e.cantidad(e.C3)).toBe(1);
      expect(e.stock()).toBe(10);
    });

    it('con ubicaciones aceptadas como texto', async () => {
      const e = escenario();

      await e.servicio.reponerProducto({
        productoId: String(e.P),
        ubicaciones: [
          {
            almacen: String(e.A1) as unknown as Types.ObjectId,
            contenedor: String(e.C2) as unknown as Types.ObjectId,
            cantidad: 1,
          },
        ],
      });

      expect(e.cantidad(e.C2)).toBe(4);
    });

    it('crea la fila si la ubicación no tenía existencias', async () => {
      const e = escenario({ c1: 6 });

      await e.servicio.reponerProducto({
        productoId: e.P,
        ubicaciones: [{ almacen: e.A1, contenedor: e.C2, cantidad: 2 }],
      });

      expect(e.cantidad(e.C2)).toBe(2);
      expect(e.existencias.docs).toHaveLength(2);
      expect(e.stock()).toBe(8);
    });

    it('a la ubicación indicada', async () => {
      const e = escenario();

      await e.servicio.reponerProducto({
        productoId: e.P,
        cantidad: 5,
        almacenId: e.A2,
        contenedorId: e.C3,
      });

      expect(e.cantidad(e.C3)).toBe(6);
      expect(e.stock()).toBe(15);
    });

    it('rechaza un contenedor que no es del almacén indicado', async () => {
      const e = escenario();

      await expect(
        e.servicio.reponerProducto({
          productoId: e.P,
          cantidad: 1,
          almacenId: e.A1,
          contenedorId: e.C3,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(e.stock()).toBe(10);
    });

    it('rechaza un contenedor que no existe', async () => {
      const e = escenario();

      await expect(
        e.servicio.reponerProducto({
          productoId: e.P,
          cantidad: 1,
          contenedorId: new Types.ObjectId(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sin ubicación usa la ubicación por defecto del producto', async () => {
      const e = escenario();

      await e.servicio.reponerProducto({ productoId: e.P, cantidad: 2 });

      expect(e.cantidad(e.C1)).toBe(8);
      expect(e.cantidad(e.C2)).toBe(3);
    });

    it('sin ubicación por defecto usa la ubicación con más stock', async () => {
      const e = escenario({ c2: 1, c3: 5 });
      const sinDefecto = e.productos.insertar({
        codigo_producto: 'SD-1',
        nombre_producto: 'Sin defecto',
        stock_inicial: 6,
      });
      e.existencias.insertar({
        producto: sinDefecto._id,
        almacen: e.A1,
        contenedor: e.C2,
        cantidad: 1,
      });
      e.existencias.insertar({
        producto: sinDefecto._id,
        almacen: e.A2,
        contenedor: e.C3,
        cantidad: 5,
      });

      await e.servicio.reponerProducto({
        productoId: sinDefecto._id,
        cantidad: 1,
      });

      const fila = e.existencias.docs.find(
        (d) =>
          String(d.producto) === String(sinDefecto._id) &&
          String(d.contenedor) === String(e.C3),
      );
      expect(fila?.cantidad).toBe(6);
    });

    it('ignora una ubicación por defecto cuyo contenedor no es de ese almacén', async () => {
      const e = escenario({ c2: 2 });
      // Por defecto: almacén Tienda con el contenedor "Estante 1" (de Central): inválida.
      e.productos.docs[0].almacen = e.A2;
      e.productos.docs[0].contenedor = e.C1;
      e.productos.docs[0].stock_inicial = 2;

      await e.servicio.reponerProducto({ productoId: e.P, cantidad: 1 });

      expect(e.cantidad(e.C2)).toBe(3);
      expect(e.cantidad(e.C1)).toBeUndefined();
    });

    it('con solo el almacén y sin filas usa el primer contenedor de ese almacén', async () => {
      const e = escenario();
      const nuevo = e.productos.insertar({
        codigo_producto: 'NU-1',
        nombre_producto: 'Nuevo',
        stock_inicial: 0,
      });

      await e.servicio.reponerProducto({
        productoId: nuevo._id,
        cantidad: 4,
        almacenId: e.A1,
      });

      const fila = e.existencias.docs.find(
        (d) => String(d.producto) === String(nuevo._id),
      );
      expect(String(fila?.contenedor)).toBe(String(e.C1));
      expect(fila?.cantidad).toBe(4);
      expect(logWarn).toHaveBeenCalled();
    });

    it('sin ninguna ubicación posible pide que se indique', async () => {
      const e = escenario();
      const nuevo = e.productos.insertar({
        codigo_producto: 'NU-2',
        nombre_producto: 'Sin ubicación',
        stock_inicial: 0,
      });

      await expect(
        e.servicio.reponerProducto({ productoId: nuevo._id, cantidad: 1 }),
      ).rejects.toThrow('indíquela');
    });

    it('si falla una ubicación, devuelve las ya repuestas', async () => {
      const e = escenario();
      e.existencias.fallarSi = () =>
        e.existencias.escrituras === 2 ? new Error('red') : undefined;

      const intento = e.servicio.reponerProducto({
        productoId: e.P,
        ubicaciones: [
          { almacen: e.A1, contenedor: e.C1, cantidad: 2 },
          { almacen: e.A1, contenedor: e.C2, cantidad: 1 },
        ],
      });

      await expect(intento).rejects.toThrow('red');
      expect(e.cantidad(e.C1)).toBe(6);
      expect(e.cantidad(e.C2)).toBe(3);
      expect(e.stock()).toBe(10);
    });

    it('rechaza un producto que no existe', async () => {
      const e = escenario();

      await expect(
        e.servicio.reponerProducto({
          productoId: new Types.ObjectId(),
          cantidad: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([0, -3, Number.NaN])('rechaza la cantidad %s', async (cantidad) => {
      const e = escenario();

      await expect(
        e.servicio.reponerProducto({ productoId: e.P, cantidad }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(e.stock()).toBe(10);
    });
  });

  // ─── Auxiliares de la conciliación ─────────────────────────────────
  describe('fijarCantidad / fijarStockProducto / sumarExistencias', () => {
    it('fijarCantidad deja la cantidad exacta y devuelve la anterior', async () => {
      const e = escenario();

      const anterior = await e.servicio.fijarCantidad(e.P, e.A1, e.C2, 7);

      expect(anterior).toBe(3);
      expect(e.cantidad(e.C2)).toBe(7);
      expect(e.stock()).toBe(10); // no toca el total del producto
    });

    it('fijarCantidad crea la fila si no existe (anterior = 0)', async () => {
      const e = escenario({ c1: 6 });

      const anterior = await e.servicio.fijarCantidad(e.P, e.A1, e.C2, 4);

      expect(anterior).toBe(0);
      expect(e.cantidad(e.C2)).toBe(4);
    });

    it.each([-1, Number.NaN])('fijarCantidad rechaza %s', async (valor) => {
      const e = escenario();

      await expect(
        e.servicio.fijarCantidad(e.P, e.A1, e.C1, valor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fijarStockProducto fija el total sincronizado', async () => {
      const e = escenario();

      await e.servicio.fijarStockProducto(e.P, 7.25);

      expect(e.stock()).toBe(7.25);
    });

    it('sumarExistencias suma todas las ubicaciones del producto', async () => {
      const e = escenario();

      expect(await e.servicio.sumarExistencias(e.P)).toBe(10);
    });

    it('sumarExistencias de un producto sin filas es 0', async () => {
      const e = escenario({});

      expect(await e.servicio.sumarExistencias(e.P)).toBe(0);
    });

    it('sumarExistencias no arrastra residuos de decimales', async () => {
      const e = escenario({ c1: 0.1, c2: 0.2 });

      expect(await e.servicio.sumarExistencias(e.P)).toBe(0.3);
    });
  });
});
