/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Logger } from '@nestjs/common';
import { model, Types } from 'mongoose';
import { ExistenciaService } from './existencia.service';
import { ExistenciaSchema } from './schema/existencia.schema';
import { StockInsuficienteException } from './stock-insuficiente.exception';
import { Doc, FakeModel } from './fake-mongo-spec';

/**
 * Reservas (doc §6.1): `Existencia` lleva `reservada` y `disponible`, con la
 * invariante `disponible = cantidad - reservada` mantenida en la MISMA
 * escritura atómica que cambia `cantidad` o `reservada`.
 *
 * Escenario base — producto "Arroz" en Central / Estante 1 con 10 unidades de
 * las que 8 están reservadas (disponible 2), y Estante 2 con 3 sin reservas.
 */
function escenario(opciones: { c1?: Doc; c2?: Doc } = {}) {
  const almacenes = new FakeModel([{ nombreAlmacen: 'Central' }]);
  const A1 = almacenes.docs[0]._id as Types.ObjectId;
  const contenedores = new FakeModel([
    { nombreContenedor: 'Estante 1', almacen: A1 },
    { nombreContenedor: 'Estante 2', almacen: A1 },
  ]);
  const [C1, C2] = contenedores.docs.map((d) => d._id as Types.ObjectId);
  const productos = new FakeModel([
    {
      codigo_producto: 'ARR-1',
      nombre_producto: 'Arroz',
      stock_inicial: 13,
      almacen: A1,
      contenedor: C1,
    },
  ]);
  const P = productos.docs[0]._id as Types.ObjectId;
  const existencias = new FakeModel();
  const fila1 = existencias.insertar({
    producto: P,
    almacen: A1,
    contenedor: C1,
    cantidad: 10,
    reservada: 8,
    ...opciones.c1,
  });
  const fila2 = existencias.insertar({
    producto: P,
    almacen: A1,
    contenedor: C2,
    cantidad: 3,
    ...opciones.c2,
  });
  const servicio = new ExistenciaService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    new FakeModel() as never,
  );

  return {
    servicio,
    existencias,
    productos,
    A1,
    C1,
    C2,
    P,
    fila1,
    fila2,
    stock: (): number => Number(productos.docs[0].stock_inicial),
  };
}

/** Umbral `$gte` que el filtro impone a un campo (con la tolerancia de redondeo). */
function umbral(filtro: unknown, campo: string): number {
  const condicion = (filtro as Record<string, { $gte?: number }>)[campo];
  expect(condicion?.$gte).toBeDefined();
  return Number(condicion.$gte);
}

/** Todas las filas cumplen `disponible = cantidad - reservada`. */
function expectInvariante(existencias: FakeModel): void {
  expect(existencias.docs.length).toBeGreaterThan(0);
  for (const fila of existencias.docs) {
    expect(fila.disponible).toBeCloseTo(
      Number(fila.cantidad) - Number(fila.reservada ?? 0),
      9,
    );
  }
}

describe('Existencia — reservada y disponible (doc §6.1)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('esquema', () => {
    const ExistenciaModel = model('ExistenciaReservasSpec', ExistenciaSchema);
    const base = () => ({
      producto: new Types.ObjectId(),
      almacen: new Types.ObjectId(),
      contenedor: new Types.ObjectId(),
    });

    it('una existencia nueva nace con reservada 0 y disponible = cantidad', async () => {
      const doc = new ExistenciaModel({ ...base(), cantidad: 7 });

      await doc.validate();

      expect(doc.reservada).toBe(0);
      expect(doc.disponible).toBe(7);
    });

    it('si se crea con reservas, disponible = cantidad - reservada', async () => {
      const doc = new ExistenciaModel({
        ...base(),
        cantidad: 7,
        reservada: 3,
      });

      await doc.validate();

      expect(doc.disponible).toBe(4);
    });

    it('rechaza reservada y disponible negativos', async () => {
      const doc = new ExistenciaModel({
        ...base(),
        cantidad: 7,
        reservada: -1,
        disponible: -2,
      });

      const error = doc.validateSync();

      expect(error?.errors.reservada).toBeDefined();
      expect(error?.errors.disponible).toBeDefined();
    });
  });

  describe('invariante en cada escritura', () => {
    it('aumentar suma a cantidad y disponible en la misma escritura', async () => {
      const e = escenario();
      const escrituras: unknown[] = [];
      e.existencias.hooks.antesDeEscribir = (_n, _f, update) =>
        escrituras.push(update);

      await e.servicio.aumentar(e.P, e.A1, e.C1, 5);

      expect(escrituras).toHaveLength(1);
      expect(escrituras[0]).toEqual({
        $inc: { cantidad: 5, disponible: 5 },
      });
      expect(e.fila1.cantidad).toBe(15);
      expect(e.fila1.reservada).toBe(8);
      expect(e.fila1.disponible).toBe(7);
      expectInvariante(e.existencias);
    });

    it('aumentar en una ubicación nueva la crea con reservada 0', async () => {
      const e = escenario();
      const C3 = new Types.ObjectId();

      await e.servicio.aumentar(e.P, e.A1, C3, 4);

      const nueva = e.existencias.docs.find(
        (d) => String(d.contenedor) === String(C3),
      );
      expect(nueva).toMatchObject({
        cantidad: 4,
        reservada: 0,
        disponible: 4,
      });
      expectInvariante(e.existencias);
    });

    it('disminuir filtra y descuenta sobre disponible, no sobre cantidad', async () => {
      const e = escenario();
      const escrituras: { filtro: unknown; update: unknown }[] = [];
      e.existencias.hooks.antesDeEscribir = (_n, filtro, update) =>
        escrituras.push({ filtro, update });

      await e.servicio.disminuir(e.P, e.A1, e.C1, 2);

      expect(escrituras).toHaveLength(1);
      expect(umbral(escrituras[0].filtro, 'disponible')).toBeCloseTo(2, 5);
      expect(escrituras[0].update).toEqual({
        $inc: { cantidad: -2, disponible: -2 },
      });
      expect(e.fila1).toMatchObject({
        cantidad: 8,
        reservada: 8,
        disponible: 0,
      });
      expectInvariante(e.existencias);
    });

    it('descontarProducto baja cantidad y disponible a la vez y deja la reserva intacta', async () => {
      const e = escenario();
      const escrituras: unknown[] = [];
      e.existencias.hooks.antesDeEscribir = (_n, _f, update) =>
        escrituras.push(update);

      await e.servicio.descontarProducto({
        productoId: e.P,
        cantidad: 2,
        almacenId: e.A1,
        contenedorId: e.C1,
      });

      expect(escrituras).toEqual([{ $inc: { cantidad: -2, disponible: -2 } }]);
      expect(e.fila1).toMatchObject({
        cantidad: 8,
        reservada: 8,
        disponible: 0,
      });
      expectInvariante(e.existencias);
    });

    it('reponerProducto sube cantidad y disponible en una fila existente y en una nueva', async () => {
      const e = escenario();
      const C3 = new Types.ObjectId();

      await e.servicio.reponerProducto({
        productoId: e.P,
        ubicaciones: [
          { almacen: e.A1, contenedor: e.C1, cantidad: 4 },
          { almacen: e.A1, contenedor: C3, cantidad: 6 },
        ],
      });

      expect(e.fila1).toMatchObject({
        cantidad: 14,
        reservada: 8,
        disponible: 6,
      });
      expect(
        e.existencias.docs.find((d) => String(d.contenedor) === String(C3)),
      ).toMatchObject({ cantidad: 6, reservada: 0, disponible: 6 });
      expectInvariante(e.existencias);
    });

    it('la compensación de un descuento fallido devuelve cantidad y disponible', async () => {
      const e = escenario({ c1: { cantidad: 10, reservada: 0 } });
      // La segunda escritura (la de la fila 2) falla: se deshace la de la fila 1.
      e.existencias.fallarSi = () =>
        e.existencias.escrituras === 2 ? new Error('red caída') : undefined;

      await expect(
        e.servicio.descontarProducto({ productoId: e.P, cantidad: 12 }),
      ).rejects.toThrow('red caída');

      expect(e.fila1).toMatchObject({ cantidad: 10, disponible: 10 });
      expectInvariante(e.existencias);
    });

    it('crearExistenciaInicial guarda reservada 0 y disponible = cantidad', async () => {
      const almacenes = new FakeModel([{ nombreAlmacen: 'Central' }]);
      const A = almacenes.docs[0]._id as Types.ObjectId;
      const contenedores = new FakeModel([
        { nombreContenedor: 'Estante', almacen: A },
      ]);
      const C = contenedores.docs[0]._id as Types.ObjectId;
      const existencias = new FakeModel();
      const creaciones: Doc[] = [];
      const original = existencias.create.bind(existencias);
      existencias.create = (datos: Doc | Doc[]) => {
        creaciones.push(...(Array.isArray(datos) ? datos : [datos]));
        return original(datos);
      };
      const servicio = new ExistenciaService(
        existencias as never,
        new FakeModel() as never,
        almacenes as never,
        contenedores as never,
        new FakeModel() as never,
      );

      await servicio.crearExistenciaInicial(
        new Types.ObjectId(),
        String(A),
        String(C),
        9,
      );

      expect(creaciones[0]).toMatchObject({
        cantidad: 9,
        reservada: 0,
        disponible: 9,
      });
    });

    it('fijarCantidad recalcula disponible con la reserva en la misma escritura', async () => {
      const e = escenario();
      const escrituras: unknown[] = [];
      e.existencias.hooks.antesDeEscribir = (_n, _f, update) =>
        escrituras.push(update);

      const anterior = await e.servicio.fijarCantidad(e.P, e.A1, e.C1, 12);

      expect(anterior).toBe(10);
      expect(escrituras).toHaveLength(1);
      expect(Array.isArray(escrituras[0])).toBe(true);
      expect(e.fila1).toMatchObject({
        cantidad: 12,
        reservada: 8,
        disponible: 4,
      });
      expectInvariante(e.existencias);
    });

    it('fijarCantidad crea la fila con reservada 0 y disponible = cantidad', async () => {
      const e = escenario();
      const C3 = new Types.ObjectId();

      await e.servicio.fijarCantidad(e.P, e.A1, C3, 5);

      expect(
        e.existencias.docs.find((d) => String(d.contenedor) === String(C3)),
      ).toMatchObject({ cantidad: 5, reservada: 0, disponible: 5 });
    });

    it('normalizarExistencias suma cantidad, reservada y disponible de las filas fusionadas', async () => {
      const e = escenario();
      // Fila antigua con los ids de texto sobre la misma ubicación que la fila 2.
      e.existencias.docs.push({
        _id: new Types.ObjectId(),
        producto: e.P,
        almacen: String(e.A1),
        contenedor: String(e.C2),
        cantidad: 4,
        reservada: 1,
        disponible: 3,
      });

      await e.servicio.normalizarExistencias(e.P);

      expect(e.fila2).toMatchObject({
        cantidad: 7,
        reservada: 1,
        disponible: 6,
      });
      expectInvariante(e.existencias);
    });

    it('la ubicación inicial sincronizada nace con reservada 0 y disponible = cantidad', async () => {
      const almacenes = new FakeModel([{ nombreAlmacen: 'Central' }]);
      const A = almacenes.docs[0]._id as Types.ObjectId;
      const contenedores = new FakeModel([
        { nombreContenedor: 'Estante', almacen: A },
      ]);
      const C = contenedores.docs[0]._id as Types.ObjectId;
      const productos = new FakeModel([
        { nombre_producto: 'Sal', stock_inicial: 6, almacen: A, contenedor: C },
      ]);
      const existencias = new FakeModel();
      const servicio = new ExistenciaService(
        existencias as never,
        productos as never,
        almacenes as never,
        contenedores as never,
        new FakeModel() as never,
      );

      await (
        servicio as unknown as {
          sincronizarUbicacionInicial: (p: unknown) => Promise<void>;
        }
      ).sincronizarUbicacionInicial(productos.docs[0]);

      expect(existencias.docs).toHaveLength(1);
      expect(existencias.docs[0]).toMatchObject({
        cantidad: 6,
        reservada: 0,
        disponible: 6,
      });
    });
  });

  describe('vender mercancía reservada', () => {
    it('descontarProducto rechaza vender lo reservado y no toca nada', async () => {
      const e = escenario({ c2: { cantidad: 0 } });

      // 10 en existencia, 8 reservadas: solo 2 son vendibles.
      await expect(
        e.servicio.descontarProducto({ productoId: e.P, cantidad: 5 }),
      ).rejects.toBeInstanceOf(StockInsuficienteException);

      expect(e.fila1).toMatchObject({
        cantidad: 10,
        reservada: 8,
        disponible: 2,
      });
      expect(e.stock()).toBe(13);
    });

    it('el mensaje cuenta solo lo disponible, no lo reservado', async () => {
      const e = escenario({ c2: { cantidad: 0 } });

      await expect(
        e.servicio.descontarProducto({ productoId: e.P, cantidad: 5 }),
      ).rejects.toThrow('disponible 2, solicitado 5');
    });

    it('descontarProducto vende lo disponible de varias ubicaciones sin consumir la reserva', async () => {
      const e = escenario();

      await e.servicio.descontarProducto({ productoId: e.P, cantidad: 5 });

      // 2 de Estante 1 (lo no reservado) y 3 de Estante 2.
      expect(e.fila1).toMatchObject({
        cantidad: 8,
        reservada: 8,
        disponible: 0,
      });
      expect(e.fila2).toMatchObject({ cantidad: 0, disponible: 0 });
      expectInvariante(e.existencias);
    });

    it('disminuir (transferencia) rechaza mover lo reservado', async () => {
      const e = escenario();

      await expect(
        e.servicio.disminuir(e.P, e.A1, e.C1, 5),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(e.fila1).toMatchObject({ cantidad: 10, disponible: 2 });
    });
  });

  describe('reservar / liberarReserva / consumirReserva', () => {
    it('reservar mueve disponible a reservada con un solo $inc condicionado a disponible', async () => {
      const e = escenario({ c1: { cantidad: 10, reservada: 0 } });
      const escrituras: { filtro: unknown; update: unknown }[] = [];
      e.existencias.hooks.antesDeEscribir = (_n, filtro, update) =>
        escrituras.push({ filtro, update });

      await e.servicio.reservar({
        productoId: e.P,
        almacenId: e.A1,
        contenedorId: e.C1,
        cantidad: 4,
      });

      expect(escrituras).toHaveLength(1);
      expect(umbral(escrituras[0].filtro, 'disponible')).toBeCloseTo(4, 5);
      expect(escrituras[0].update).toEqual({
        $inc: { reservada: 4, disponible: -4 },
      });
      expect(e.fila1).toMatchObject({
        cantidad: 10,
        reservada: 4,
        disponible: 6,
      });
      expectInvariante(e.existencias);
    });

    it('reservar más de lo disponible se rechaza y no cambia nada', async () => {
      const e = escenario();

      await expect(
        e.servicio.reservar({
          productoId: e.P,
          almacenId: e.A1,
          contenedorId: e.C1,
          cantidad: 3,
        }),
      ).rejects.toBeInstanceOf(StockInsuficienteException);

      expect(e.fila1).toMatchObject({
        cantidad: 10,
        reservada: 8,
        disponible: 2,
      });
    });

    it('reservar en una ubicación sin existencia se rechaza', async () => {
      const e = escenario();

      await expect(
        e.servicio.reservar({
          productoId: e.P,
          almacenId: e.A1,
          contenedorId: new Types.ObjectId(),
          cantidad: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('liberarReserva devuelve reservada a disponible con un solo $inc', async () => {
      const e = escenario();
      const escrituras: { filtro: unknown; update: unknown }[] = [];
      e.existencias.hooks.antesDeEscribir = (_n, filtro, update) =>
        escrituras.push({ filtro, update });

      await e.servicio.liberarReserva({
        productoId: e.P,
        almacenId: e.A1,
        contenedorId: e.C1,
        cantidad: 5,
      });

      expect(umbral(escrituras[0].filtro, 'reservada')).toBeCloseTo(5, 5);
      expect(escrituras[0].update).toEqual({
        $inc: { reservada: -5, disponible: 5 },
      });
      expect(e.fila1).toMatchObject({
        cantidad: 10,
        reservada: 3,
        disponible: 7,
      });
      expectInvariante(e.existencias);
    });

    it('liberar más de lo reservado se rechaza y no cambia nada', async () => {
      const e = escenario();

      await expect(
        e.servicio.liberarReserva({
          productoId: e.P,
          almacenId: e.A1,
          contenedorId: e.C1,
          cantidad: 9,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(e.fila1).toMatchObject({ reservada: 8, disponible: 2 });
    });

    it('consumirReserva baja cantidad y reservada; disponible no cambia', async () => {
      const e = escenario();
      const escrituras: { filtro: unknown; update: unknown }[] = [];
      e.existencias.hooks.antesDeEscribir = (_n, filtro, update) =>
        escrituras.push({ filtro, update });

      const r = await e.servicio.consumirReserva({
        productoId: e.P,
        almacenId: e.A1,
        contenedorId: e.C1,
        cantidad: 6,
      });

      expect(umbral(escrituras[0].filtro, 'reservada')).toBeCloseTo(6, 5);
      expect(escrituras[0].update).toEqual({
        $inc: { cantidad: -6, reservada: -6 },
      });
      expect(e.fila1).toMatchObject({
        cantidad: 4,
        reservada: 2,
        disponible: 2,
      });
      // El total sincronizado del producto baja lo que salió físicamente.
      expect(e.stock()).toBe(7);
      expect(r.stockTotal).toBe(7);
      expectInvariante(e.existencias);
    });

    it('consumir más de lo reservado se rechaza y no cambia nada', async () => {
      const e = escenario();

      await expect(
        e.servicio.consumirReserva({
          productoId: e.P,
          almacenId: e.A1,
          contenedorId: e.C1,
          cantidad: 9,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(e.fila1).toMatchObject({ cantidad: 10, reservada: 8 });
      expect(e.stock()).toBe(13);
    });

    it.each([0, -1, Number.NaN])('rechaza la cantidad %p', async (cantidad) => {
      const e = escenario();

      await expect(
        e.servicio.reservar({
          productoId: e.P,
          almacenId: e.A1,
          contenedorId: e.C1,
          cantidad,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('relleno de disponible al arrancar (onModuleInit)', () => {
    /** Documento anterior a esta fase: sin `reservada` ni `disponible`. */
    const antiguo = (e: ReturnType<typeof escenario>, cantidad: number): Doc => {
      const fila: Doc = {
        _id: new Types.ObjectId(),
        producto: e.P,
        almacen: e.A1,
        contenedor: new Types.ObjectId(),
        cantidad,
      };
      e.existencias.docs.push(fila);
      return fila;
    };

    it('completa reservada y disponible solo donde falta disponible', async () => {
      const e = escenario();
      const vieja = antiguo(e, 9);
      const conReserva = antiguo(e, 5);
      conReserva.reservada = 2;

      await e.servicio.onModuleInit();

      expect(vieja).toMatchObject({ reservada: 0, disponible: 9 });
      expect(conReserva).toMatchObject({ reservada: 2, disponible: 3 });
      // Las filas ya migradas no se tocan.
      expect(e.fila1).toMatchObject({ cantidad: 10, reservada: 8, disponible: 2 });
      expectInvariante(e.existencias);
    });

    it('es idempotente: la segunda vez no escribe nada nuevo', async () => {
      const e = escenario();
      const vieja = antiguo(e, 9);

      await e.servicio.onModuleInit();
      vieja.reservada = 4;
      vieja.disponible = 5;
      await e.servicio.onModuleInit();

      expect(vieja).toMatchObject({ reservada: 4, disponible: 5 });
    });

    it('si falla solo avisa en el log: nunca impide arrancar', async () => {
      const e = escenario();
      e.existencias.fallarSi = () => new Error('sin conexión');

      await expect(e.servicio.onModuleInit()).resolves.toBeUndefined();

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining('sin conexión'),
      );
    });
  });
});
