/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DevolucionService } from './devolucion.service';
import { DevolucionOrigenService } from './devolucion-origen.service';
import { Doc, FakeModel } from '../exitencia/fake-mongo-spec';
import {
  DevolucionOrigenTipo,
  DevolucionTipo,
  EstadoDevolucion,
  FormaDevolucionDinero,
} from './schema/devolucion.schema';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';

const USUARIO = { userId: 'u1', nombre: 'Gerente Uno' };

const id = (): Types.ObjectId => new Types.ObjectId();
const A = id();
const C1 = id();
const C2 = id();
const P1 = id();
const P2 = id();
const CLIENTE = id();

/** Resultado de mover stock en `ExistenciaService`: ubicaciones tocadas y total. */
const movimiento = (
  ubicaciones: {
    almacen: Types.ObjectId;
    contenedor: Types.ObjectId;
    cantidad: number;
  }[],
  stockTotal = 100,
) => ({ ubicaciones, stockTotal });

interface Opciones {
  pago?: Doc;
  unificado?: boolean;
  venta?: Partial<Doc>;
}

function montar(opciones: Opciones = {}) {
  const pagos = new FakeModel([
    opciones.pago ?? { metodoPago: 'efectivo', esCuentaCasa: false },
  ]);
  const productos = new FakeModel([
    { _id: P1, nombre_producto: 'Arroz', precio_venta: 10, stock_inicial: 50 },
    { _id: P2, nombre_producto: 'Frijol', precio_venta: 20, stock_inicial: 50 },
  ]);
  const ventas = new FakeModel([
    {
      subtotal_venta: 65,
      descuento_total: 5,
      impuesto: 6.5,
      pago: pagos.docs[0]._id,
      productos: [
        {
          productoId: P1,
          cantidad: 5,
          descuentoMonto: 0,
          ubicaciones: [
            { almacen: A, contenedor: C1, cantidad: 3 },
            { almacen: A, contenedor: C2, cantidad: 2 },
          ],
        },
        { productoId: P2, cantidad: 1, descuentoMonto: 5 },
      ],
      ...opciones.venta,
    },
  ]);
  const facturas = new FakeModel();
  const compras = new FakeModel();
  const devoluciones = new FakeModel();
  const acumulados = new FakeModel([], {
    unico: ['origenTipo', 'origenId', 'productoId'],
  });

  const kardexFilas: Doc[] = [];
  const kardex = {
    create: jest.fn((fila: Doc) => {
      kardexFilas.push(fila);
      return Promise.resolve(fila);
    }),
    deleteMany: jest.fn((filtro: Doc) => ({
      exec: () => {
        for (let i = kardexFilas.length - 1; i >= 0; i--) {
          if (kardexFilas[i].referencia === filtro.referencia)
            kardexFilas.splice(i, 1);
        }
        return Promise.resolve({ deletedCount: 1 });
      },
    })),
  };

  let n = 0;
  const consecutivo = {
    siguiente: jest.fn(() =>
      Promise.resolve(`DEV-${String(++n).padStart(6, '0')}`),
    ),
  };
  const existencia = {
    estaUnificado: jest.fn().mockResolvedValue(opciones.unificado ?? true),
    reponerProducto: jest.fn(
      (o: {
        ubicaciones?: {
          almacen: Types.ObjectId;
          contenedor: Types.ObjectId;
          cantidad: number;
        }[];
        cantidad?: number;
      }) =>
        Promise.resolve(
          movimiento(
            o.ubicaciones ?? [
              { almacen: A, contenedor: C1, cantidad: o.cantidad ?? 0 },
            ],
          ),
        ),
    ),
    descontarProducto: jest.fn(
      (o: {
        almacenId?: Types.ObjectId;
        contenedorId?: Types.ObjectId;
        cantidad: number;
      }) =>
        Promise.resolve(
          movimiento(
            [
              {
                almacen: o.almacenId ?? A,
                contenedor: o.contenedorId ?? C1,
                cantidad: o.cantidad,
              },
            ],
            90,
          ),
        ),
    ),
  };

  const origen = new DevolucionOrigenService(
    ventas as never,
    facturas as never,
    compras as never,
    productos as never,
    pagos as never,
  );
  const servicio = new DevolucionService(
    devoluciones as never,
    acumulados as never,
    kardex as never,
    productos as never,
    consecutivo as never,
    existencia as never,
    origen,
  );

  return {
    servicio,
    ventas,
    facturas,
    compras,
    productos,
    pagos,
    devoluciones,
    acumulados,
    kardex,
    kardexFilas,
    existencia,
    consecutivo,
    ventaId: ventas.docs[0]._id as Types.ObjectId,
  };
}

const dtoVenta = (
  origenRef: Types.ObjectId,
  lineas: { producto: Types.ObjectId; solicitada: number; entregada: number }[],
  extra: Partial<CreateDevolucionDto> = {},
): CreateDevolucionDto => ({
  tipo: DevolucionTipo.VENTA,
  origenTipo: DevolucionOrigenTipo.VENTA,
  origenRef: origenRef.toHexString(),
  motivo: 'Producto en mal estado',
  lineas: lineas.map((l) => ({
    producto: l.producto.toHexString(),
    cantidadSolicitada: l.solicitada,
    cantidadEntregada: l.entregada,
  })),
  autorizadoPor: 'Ana Gerente',
  recibidoPor: 'Luis Almacén',
  firma: 'firma-base64',
  ...extra,
});

describe('DevolucionService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('devolución de venta', () => {
    it('repone el stock a las ubicaciones originales, escribe Kardex DEVOLUCION con el consecutivo y registra el vale', async () => {
      const m = montar();

      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 4, entregada: 4 }]),
        USUARIO,
      );

      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
      expect(m.existencia.reponerProducto).toHaveBeenCalledWith({
        productoId: P1.toHexString(),
        ubicaciones: [
          { almacen: A, contenedor: C1, cantidad: 3 },
          { almacen: A, contenedor: C2, cantidad: 1 },
        ],
      });
      expect(m.existencia.descontarProducto).not.toHaveBeenCalled();
      expect(m.kardexFilas).toHaveLength(1);
      expect(m.kardexFilas[0]).toMatchObject({
        tipo: 'devolucion',
        cantidad: 4,
        referencia: 'DEV-000001',
      });
      expect(String(m.kardexFilas[0].productoId)).toBe(P1.toHexString());
      expect(res).toMatchObject({
        numeroConsecutivo: 'DEV-000001',
        tipo: 'venta',
        origenTipo: 'venta',
        estado: EstadoDevolucion.REGISTRADA,
        motivo: 'Producto en mal estado',
        autorizadoPor: 'Ana Gerente',
        recibidoPor: 'Luis Almacén',
        firma: 'firma-base64',
        registradoPor: USUARIO,
      });
      expect(String(res.origenRef)).toBe(m.ventaId.toHexString());
    });

    it('calcula el importe en el servidor con los precios del origen (neto + impuesto), moneda CUP', async () => {
      const m = montar();

      // Arroz: 10 c/u; Frijol: 20 menos 5 de descuento = 15 neto. Neto total 65,
      // impuesto 6.5 -> factor 1.1. 4 arroz = 4 * 10 * 1.1.
      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 4, entregada: 4 }]),
        USUARIO,
      );

      expect(res.montoDevuelto).toBe(44);
      expect(res.moneda).toBe('CUP');
      expect(res.lineas[0]).toMatchObject({ precioUnitario: 10, importe: 44 });
      expect(m.kardexFilas[0].importeCUP).toBe(44);
    });

    it('devuelve en efectivo si el pago original fue en efectivo cobrado', async () => {
      const m = montar();
      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 1, entregada: 1 }]),
        USUARIO,
      );
      expect(res.formaDevolucionDinero).toBe(FormaDevolucionDinero.EFECTIVO);
    });

    it('si el pago fue por transferencia el dinero vuelve como nota de crédito', async () => {
      const m = montar({
        pago: { metodoPago: 'transferencia', clienteId: CLIENTE },
      });
      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 1, entregada: 1 }]),
        USUARIO,
      );
      expect(res.formaDevolucionDinero).toBe(
        FormaDevolucionDinero.NOTA_CREDITO,
      );
      expect(String(res.cliente)).toBe(CLIENTE.toHexString());
    });

    it('si fue a crédito no hay efectivo: descuenta la deuda y conserva el monto', async () => {
      const m = montar({ pago: { metodoPago: 'credito', clienteId: CLIENTE } });
      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 2, entregada: 2 }]),
        USUARIO,
      );
      expect(res.formaDevolucionDinero).toBe(
        FormaDevolucionDinero.DESCUENTA_DEUDA,
      );
      expect(res.montoDevuelto).toBe(22);
      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
    });

    it('una venta cuenta casa (nada cobrado) tampoco devuelve efectivo', async () => {
      const m = montar({
        pago: { metodoPago: 'efectivo', esCuentaCasa: true },
      });
      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 1, entregada: 1 }]),
        USUARIO,
      );
      expect(res.formaDevolucionDinero).toBe(
        FormaDevolucionDinero.DESCUENTA_DEUDA,
      );
    });

    it('rechaza una forma de dinero incoherente con el pago original y no toca stock ni contadores', async () => {
      const m = montar({ pago: { metodoPago: 'credito', clienteId: CLIENTE } });

      await expect(
        m.servicio.registrar(
          dtoVenta(m.ventaId, [{ producto: P1, solicitada: 1, entregada: 1 }], {
            formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
          }),
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(m.existencia.reponerProducto).not.toHaveBeenCalled();
      expect(m.acumulados.docs).toHaveLength(0);
      expect(m.devoluciones.docs).toHaveLength(0);
    });

    it('acepta la forma enviada si coincide con la que corresponde', async () => {
      const m = montar();
      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 1, entregada: 1 }], {
          formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
        }),
        USUARIO,
      );
      expect(res.formaDevolucionDinero).toBe('efectivo');
    });

    it('el origen es obligatorio y debe existir', async () => {
      const m = montar();
      await expect(
        m.servicio.registrar(
          dtoVenta(id(), [{ producto: P1, solicitada: 1, entregada: 1 }]),
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(m.existencia.reponerProducto).not.toHaveBeenCalled();
      expect(m.consecutivo.siguiente).not.toHaveBeenCalled();
    });

    it('cada línea debe pertenecer al origen', async () => {
      const m = montar();
      await expect(
        m.servicio.registrar(
          dtoVenta(m.ventaId, [
            { producto: id(), solicitada: 1, entregada: 1 },
          ]),
          USUARIO,
        ),
      ).rejects.toThrow(/no pertenece/);
      expect(m.existencia.reponerProducto).not.toHaveBeenCalled();
    });

    it('lo entregado no puede superar lo solicitado, ni todo quedar en cero, ni repetirse un producto', async () => {
      const m = montar();
      const llamar = (
        lineas: {
          producto: Types.ObjectId;
          solicitada: number;
          entregada: number;
        }[],
      ) => m.servicio.registrar(dtoVenta(m.ventaId, lineas), USUARIO);

      await expect(
        llamar([{ producto: P1, solicitada: 1, entregada: 2 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        llamar([{ producto: P1, solicitada: 1, entregada: 0 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        llamar([
          { producto: P1, solicitada: 1, entregada: 1 },
          { producto: P1, solicitada: 1, entregada: 1 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(m.existencia.reponerProducto).not.toHaveBeenCalled();
    });

    it('una línea con cantidad entregada 0 se conserva en el vale pero no mueve stock', async () => {
      const m = montar();
      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [
          { producto: P1, solicitada: 2, entregada: 2 },
          { producto: P2, solicitada: 1, entregada: 0 },
        ]),
        USUARIO,
      );
      expect(res.lineas).toHaveLength(2);
      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
      expect(m.kardexFilas).toHaveLength(1);
    });

    it('lo devuelto acumulado por producto nunca supera lo vendido', async () => {
      const m = montar();
      await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 3, entregada: 3 }]),
        USUARIO,
      );

      await expect(
        m.servicio.registrar(
          dtoVenta(m.ventaId, [{ producto: P1, solicitada: 3, entregada: 3 }]),
          USUARIO,
        ),
      ).rejects.toThrow(/ya se devolvi/);

      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
      expect(m.acumulados.docs[0].devuelta).toBe(3);
      // la segunda sí cabe si es lo que queda
      await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 2, entregada: 2 }]),
        USUARIO,
      );
      expect(m.acumulados.docs[0].devuelta).toBe(5);
    });

    it('devoluciones sucesivas llenan las ubicaciones originales sin repetir lo ya devuelto', async () => {
      const m = montar();
      await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 3, entregada: 3 }]),
        USUARIO,
      );
      await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 2, entregada: 2 }]),
        USUARIO,
      );

      expect(m.existencia.reponerProducto).toHaveBeenNthCalledWith(1, {
        productoId: P1.toHexString(),
        ubicaciones: [{ almacen: A, contenedor: C1, cantidad: 3 }],
      });
      expect(m.existencia.reponerProducto).toHaveBeenNthCalledWith(2, {
        productoId: P1.toHexString(),
        ubicaciones: [{ almacen: A, contenedor: C2, cantidad: 2 }],
      });
    });

    it('dos devoluciones simultáneas no pueden devolver entre las dos más de lo vendido', async () => {
      const m = montar();
      const llamar = () =>
        m.servicio.registrar(
          dtoVenta(m.ventaId, [{ producto: P1, solicitada: 3, entregada: 3 }]),
          USUARIO,
        );

      const resultados = await Promise.allSettled([llamar(), llamar()]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
        1,
      );
      expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
      expect(m.acumulados.docs[0].devuelta).toBe(3);
      expect(m.kardexFilas).toHaveLength(1);
    });

    it('una devolución a medias libera su cupo: si falla una línea se compensa el stock y se libera lo reservado', async () => {
      const m = montar();
      m.existencia.reponerProducto
        .mockImplementationOnce((o) =>
          Promise.resolve(movimiento(o.ubicaciones ?? [])),
        )
        .mockRejectedValueOnce(new Error('red caída'));

      await expect(
        m.servicio.registrar(
          dtoVenta(m.ventaId, [
            { producto: P1, solicitada: 2, entregada: 2 },
            { producto: P2, solicitada: 1, entregada: 1 },
          ]),
          USUARIO,
        ),
      ).rejects.toThrow('red caída');

      // lo ya repuesto de Arroz se deshace
      expect(m.existencia.descontarProducto).toHaveBeenCalledWith({
        productoId: P1.toHexString(),
        cantidad: 2,
        almacenId: A,
        contenedorId: C1,
      });
      expect(m.kardexFilas).toHaveLength(0);
      expect(m.acumulados.docs.every((d) => d.devuelta === 0)).toBe(true);
      expect(m.devoluciones.docs).toHaveLength(1);
      expect(m.devoluciones.docs[0].estado).toBe(EstadoDevolucion.FALLIDA);

      // el cupo quedó libre: ahora la devolución completa sí cabe
      await expect(
        m.servicio.registrar(
          dtoVenta(m.ventaId, [{ producto: P1, solicitada: 5, entregada: 5 }]),
          USUARIO,
        ),
      ).resolves.toBeDefined();
    });

    it('si el Kardex no se guarda se deshace el stock y no queda movimiento sin documento', async () => {
      const m = montar();
      m.kardex.create.mockRejectedValueOnce(new Error('kardex caído'));

      await expect(
        m.servicio.registrar(
          dtoVenta(m.ventaId, [{ producto: P1, solicitada: 2, entregada: 2 }]),
          USUARIO,
        ),
      ).rejects.toThrow('kardex caído');

      expect(m.existencia.descontarProducto).toHaveBeenCalledTimes(1);
      expect(m.kardex.deleteMany).toHaveBeenCalledWith({
        referencia: 'DEV-000001',
      });
      expect(m.devoluciones.docs[0].estado).toBe(EstadoDevolucion.FALLIDA);
      expect(m.acumulados.docs[0].devuelta).toBe(0);
    });

    it('la aplicación ocurre exactamente una vez, también con llamadas simultáneas', async () => {
      const m = montar();
      const pendiente = m.devoluciones.insertar({
        numeroConsecutivo: 'DEV-000099',
        tipo: 'venta',
        origenTipo: 'venta',
        origenRef: m.ventaId,
        motivo: 'x',
        estado: EstadoDevolucion.PENDIENTE,
        moneda: 'CUP',
        lineas: [
          {
            producto: P1,
            cantidadSolicitada: 2,
            cantidadEntregada: 2,
            precioUnitario: 10,
            importe: 20,
            ubicaciones: [{ almacen: A, contenedor: C1, cantidad: 2 }],
            sinUbicacion: 0,
          },
        ],
      });
      const idPendiente = String(pendiente._id);

      const [a, b] = await Promise.all([
        m.servicio.aplicar(idPendiente),
        m.servicio.aplicar(idPendiente),
      ]);

      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
      expect(m.kardexFilas).toHaveLength(1);
      expect(
        a.estado === EstadoDevolucion.REGISTRADA ||
          b.estado === EstadoDevolucion.REGISTRADA,
      ).toBe(true);

      // una tercera llamada sobre el vale ya registrado no hace nada
      const c = await m.servicio.aplicar(idPendiente);
      expect(c.estado).toBe(EstadoDevolucion.REGISTRADA);
      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
      expect(m.kardexFilas).toHaveLength(1);
    });

    it('antes de activar el modo unificado mueve Producto.stock_inicial, sin tocar Existencia', async () => {
      const m = montar({ unificado: false });

      const res = await m.servicio.registrar(
        dtoVenta(m.ventaId, [{ producto: P1, solicitada: 2, entregada: 2 }]),
        USUARIO,
      );

      expect(m.existencia.reponerProducto).not.toHaveBeenCalled();
      expect(m.productos.docs[0].stock_inicial).toBe(52);
      expect(m.kardexFilas[0]).toMatchObject({
        tipo: 'devolucion',
        cantidad: 2,
        stock: 52,
      });
      expect(res.estado).toBe(EstadoDevolucion.REGISTRADA);
    });
  });

  describe('devolución de factura', () => {
    const facturaBase = (extra: Partial<Doc> = {}): Doc => ({
      id: 'FAC-000001',
      estado: 'confirmada',
      inventarioAplicado: true,
      metodoPago: 'efectivo',
      moneda: 'CUP',
      total: 110,
      clienteId: CLIENTE,
      items: [{ productoId: P1.toHexString(), cantidad: 10, total: 100 }],
      inventarioUbicaciones: [
        { productoId: P1, almacen: A, contenedor: C2, cantidad: 10 },
      ],
      ...extra,
    });
    const dtoFactura = (
      facturaId: Types.ObjectId,
      entregada: number,
    ): CreateDevolucionDto => ({
      ...dtoVenta(facturaId, [
        { producto: P1, solicitada: entregada, entregada },
      ]),
      origenTipo: DevolucionOrigenTipo.FACTURA,
    });

    it('repone a la ubicación de la que salió y calcula el importe con el total de la factura', async () => {
      const m = montar();
      const f = m.facturas.insertar(facturaBase());

      const res = await m.servicio.registrar(dtoFactura(f._id, 4), USUARIO);

      expect(m.existencia.reponerProducto).toHaveBeenCalledWith({
        productoId: P1.toHexString(),
        ubicaciones: [{ almacen: A, contenedor: C2, cantidad: 4 }],
      });
      // neto 10 c/u, factor 110/100 -> 4 * 10 * 1.1
      expect(res.montoDevuelto).toBe(44);
      expect(res.formaDevolucionDinero).toBe('efectivo');
      expect(m.kardexFilas[0]).toMatchObject({
        tipo: 'devolucion',
        referencia: 'DEV-000001',
      });
    });

    it('una factura a crédito descuenta la deuda; una anulada no admite devolución', async () => {
      const m = montar();
      const credito = m.facturas.insertar(
        facturaBase({ metodoPago: 'credito' }),
      );
      const anulada = m.facturas.insertar(facturaBase({ estado: 'anulada' }));
      const sinInventario = m.facturas.insertar(
        facturaBase({ inventarioAplicado: false }),
      );

      const res = await m.servicio.registrar(
        dtoFactura(credito._id, 1),
        USUARIO,
      );
      expect(res.formaDevolucionDinero).toBe('descuenta_deuda');

      await expect(
        m.servicio.registrar(dtoFactura(anulada._id, 1), USUARIO),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        m.servicio.registrar(dtoFactura(sinInventario._id, 1), USUARIO),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(m.existencia.reponerProducto).toHaveBeenCalledTimes(1);
    });

    it('el tope acumulado también rige para facturas', async () => {
      const m = montar();
      const f = m.facturas.insertar(facturaBase());
      await m.servicio.registrar(dtoFactura(f._id, 8), USUARIO);
      await expect(
        m.servicio.registrar(dtoFactura(f._id, 3), USUARIO),
      ).rejects.toThrow(/ya se devolvi/);
    });
  });

  describe('devolución a proveedor', () => {
    const compraBase = (): Doc => ({
      producto: P1,
      almacen: A,
      contenedor: C1,
      cantidad: 10,
      costo_unitario: 3,
      total: 30,
    });
    const dtoProveedor = (
      compraId: Types.ObjectId,
      cantidad: number,
    ): CreateDevolucionDto => ({
      ...dtoVenta(
        compraId,
        [{ producto: P1, solicitada: cantidad, entregada: cantidad }],
        {
          motivo: 'Lote vencido',
        },
      ),
      tipo: DevolucionTipo.PROVEEDOR,
      origenTipo: DevolucionOrigenTipo.REGISTRO_COMPRA,
    });

    it('es una SALIDA con su propio motivo, nunca una compra negativa, y no devuelve dinero a un cliente', async () => {
      const m = montar();
      const compra = m.compras.insertar(compraBase());

      const res = await m.servicio.registrar(
        dtoProveedor(compra._id, 4),
        USUARIO,
      );

      expect(m.existencia.descontarProducto).toHaveBeenCalledWith({
        productoId: P1.toHexString(),
        cantidad: 4,
        almacenId: A,
        contenedorId: C1,
      });
      expect(m.existencia.reponerProducto).not.toHaveBeenCalled();
      expect(m.kardexFilas).toHaveLength(1);
      expect(m.kardexFilas[0].tipo).toBe('salida');
      expect(m.kardexFilas[0].tipo).not.toBe('compra');
      expect(m.kardexFilas[0].motivo).toMatch(/proveedor/i);
      expect(m.kardexFilas[0].motivo).toMatch(/Lote vencido/);
      expect(m.kardexFilas[0].referencia).toBe('DEV-000001');
      expect(m.kardexFilas[0].stock).toBe(90);
      expect(res.tipo).toBe('proveedor');
      expect(res.formaDevolucionDinero).toBeUndefined();
      expect(res.montoDevuelto).toBe(12);
    });

    it('lo devuelto al proveedor nunca supera lo comprado', async () => {
      const m = montar();
      const compra = m.compras.insertar(compraBase());
      await m.servicio.registrar(dtoProveedor(compra._id, 7), USUARIO);
      await expect(
        m.servicio.registrar(dtoProveedor(compra._id, 4), USUARIO),
      ).rejects.toThrow(/ya se devolvi/);
      expect(m.existencia.descontarProducto).toHaveBeenCalledTimes(1);
    });

    it('si falta stock para devolver, no queda nada a medias', async () => {
      const m = montar();
      const compra = m.compras.insertar(compraBase());
      m.existencia.descontarProducto.mockRejectedValueOnce(
        new BadRequestException('Stock insuficiente'),
      );

      await expect(
        m.servicio.registrar(dtoProveedor(compra._id, 4), USUARIO),
      ).rejects.toThrow('Stock insuficiente');

      expect(m.kardexFilas).toHaveLength(0);
      expect(m.acumulados.docs[0].devuelta).toBe(0);
      expect(m.devoluciones.docs[0].estado).toBe(EstadoDevolucion.FALLIDA);
    });

    it('tipo y origen deben ser coherentes y no se envía forma de dinero', async () => {
      const m = montar();
      const compra = m.compras.insertar(compraBase());

      await expect(
        m.servicio.registrar(
          {
            ...dtoProveedor(compra._id, 1),
            origenTipo: DevolucionOrigenTipo.VENTA,
          },
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        m.servicio.registrar(
          {
            ...dtoProveedor(compra._id, 1),
            formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
          },
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        m.servicio.registrar(
          {
            ...dtoVenta(m.ventaId, [
              { producto: P1, solicitada: 1, entregada: 1 },
            ]),
            origenTipo: DevolucionOrigenTipo.REGISTRO_COMPRA,
          },
          USUARIO,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(m.existencia.descontarProducto).not.toHaveBeenCalled();
    });
  });

  describe('consultas', () => {
    const modeloListado = (datos: Doc[] = [], total = 0) => {
      const cadena = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(datos),
      };
      const modelo = {
        find: jest.fn().mockReturnValue(cadena),
        countDocuments: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue(total) }),
      };
      const servicio = new DevolucionService(
        modelo as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      return { servicio, modelo, cadena };
    };

    it('lista por forma de dinero y rango de fechas (el cuadre de caja busca efectivo); una fecha sola incluye todo el día', async () => {
      const { servicio, modelo } = modeloListado(
        [{ numeroConsecutivo: 'DEV-000001' }],
        1,
      );

      const res = await servicio.listar({
        formaDevolucionDinero: FormaDevolucionDinero.EFECTIVO,
        desde: '2026-11-01',
        hasta: '2026-11-03',
      });

      expect(modelo.find).toHaveBeenCalledWith({
        estado: EstadoDevolucion.REGISTRADA,
        formaDevolucionDinero: 'efectivo',
        fecha: {
          $gte: new Date('2026-11-01T00:00:00.000Z'),
          $lt: new Date('2026-11-04T00:00:00.000Z'),
        },
      });
      expect(res).toMatchObject({ total: 1, pagina: 1, limite: 50 });
    });

    it('con hora usa ese instante como tope y acepta filtrar por estado y origen', async () => {
      const { servicio, modelo } = modeloListado();
      const origen = id();

      await servicio.listar({
        hasta: '2026-11-03T10:00:00.000Z',
        estado: EstadoDevolucion.FALLIDA,
        origenRef: origen.toHexString(),
        tipo: DevolucionTipo.VENTA,
        pagina: 2,
        limite: 10,
      });

      const filtro = modelo.find.mock.calls[0][0] as Doc;
      expect(filtro.estado).toBe('fallida');
      expect(filtro.tipo).toBe('venta');
      expect(String(filtro.origenRef)).toBe(origen.toHexString());
      expect(filtro.fecha).toEqual({
        $lte: new Date('2026-11-03T10:00:00.000Z'),
      });
    });

    it('findOne valida el id y responde 404 si no existe', async () => {
      const m = montar();
      await expect(m.servicio.findOne('no-es-id')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        m.servicio.findOne(id().toHexString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
