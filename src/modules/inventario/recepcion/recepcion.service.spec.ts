import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { FakeModel } from '../exitencia/fake-mongo-spec';
import { RecepcionService } from './recepcion.service';
import { CreateRecepcionDto } from './dto/create-recepcion.dto';
import {
  EstadoRecepcion,
  Recepcion,
  TipoDocumentoOrigen,
} from './schema/recepcion.schema';

type Doc = Record<string, unknown>;

/**
 * Modelo de Recepción en memoria: aplica los valores por defecto del esquema
 * y las escrituras condicionales (`$ne`, `$set`, `$unset`) que usa el
 * servicio para reclamar el registro de forma atómica.
 */
class RecepcionFake {
  docs: Doc[] = [];
  escrituras = 0;

  private coincide(doc: Doc, filtro: Doc): boolean {
    return Object.entries(filtro).every(([campo, esperado]) => {
      const valor = doc[campo];
      if (
        typeof esperado === 'object' &&
        esperado !== null &&
        !(esperado instanceof Types.ObjectId) &&
        '$ne' in esperado
      ) {
        return valor !== esperado.$ne;
      }
      return String(valor) === String(esperado);
    });
  }

  private consulta<T>(resolver: () => T) {
    const q = {
      lean: () => q,
      sort: () => q,
      exec: () => Promise.resolve(resolver()),
    };
    return q;
  }

  create(datos: Doc): Promise<Doc> {
    const doc: Doc = {
      _id: new Types.ObjectId(),
      estado: EstadoRecepcion.BORRADOR,
      inventarioAplicado: false,
      ...datos,
    };
    this.docs.push(doc);
    return Promise.resolve({ ...doc });
  }

  findById(id: unknown) {
    return this.consulta(() => {
      const doc = this.docs.find((d) => String(d._id) === String(id));
      return doc ? { ...doc } : null;
    });
  }

  find(filtro: Doc = {}) {
    return this.consulta(() =>
      this.docs.filter((d) => this.coincide(d, filtro)).map((d) => ({ ...d })),
    );
  }

  findOneAndUpdate(filtro: Doc, update: { $set?: Doc; $unset?: Doc }) {
    return this.consulta(() => {
      this.escrituras += 1;
      const doc = this.docs.find((d) => this.coincide(d, filtro));
      if (!doc) return null;
      Object.assign(doc, update.$set ?? {});
      Object.keys(update.$unset ?? {}).forEach((campo) => delete doc[campo]);
      return { ...doc };
    });
  }
}

const hoy = '2026-10-05';

function escenario() {
  const almacenes = new FakeModel([
    { nombreAlmacen: 'Central' },
    { nombreAlmacen: 'Tienda' },
  ]);
  const [A1, A2] = almacenes.docs.map((d) => d._id as Types.ObjectId);
  const contenedores = new FakeModel([
    { nombreContenedor: 'Estante 1', almacen: A1 },
    { nombreContenedor: 'Vitrina', almacen: A2 },
  ]);
  const [C1, C2] = contenedores.docs.map((d) => d._id as Types.ObjectId);
  const productos = new FakeModel([
    { nombre_producto: 'Arroz', stock_inicial: 0 },
    { nombre_producto: 'Frijol', stock_inicial: 0 },
  ]);
  const [P1, P2] = productos.docs.map((d) => d._id as Types.ObjectId);
  const proveedores = new FakeModel([{ nombre: 'Proveedor SA' }]);
  const PR = proveedores.docs[0]._id as Types.ObjectId;

  const recepciones = new RecepcionFake();
  const consecutivo = { siguiente: jest.fn().mockResolvedValue('REC-000001') };
  const empresa = {
    obtener: jest
      .fn()
      .mockResolvedValue({ nombre: 'Xilef SA', ruc_nit: '01234567890' }),
  };
  const movimiento = (
    cantidad: number,
    almacen: Types.ObjectId,
    contenedor: Types.ObjectId,
  ) => ({
    ubicaciones: [{ almacen, contenedor, cantidad }],
    stockTotal: cantidad,
  });
  const existencia = {
    reponerProducto: jest.fn(
      (o: {
        cantidad: number;
        almacenId: Types.ObjectId;
        contenedorId: Types.ObjectId;
      }) =>
        Promise.resolve(movimiento(o.cantidad, o.almacenId, o.contenedorId)),
    ),
    descontarProducto: jest.fn().mockResolvedValue(undefined),
  };
  let seq = 0;
  const registroCompra = {
    registrarLinea: jest.fn(() => {
      seq += 1;
      return Promise.resolve({
        registro: { _id: new Types.ObjectId() },
        kardexId: `kardex-${seq}`,
      });
    }),
    descartarLinea: jest.fn().mockResolvedValue(undefined),
  };

  const servicio = new RecepcionService(
    recepciones as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    proveedores as never,
    consecutivo as never,
    empresa as never,
    existencia as never,
    registroCompra as never,
  );

  const dto = (
    extra: Partial<CreateRecepcionDto> = {},
  ): CreateRecepcionDto => ({
    almacenReceptor: String(A1),
    proveedor: String(PR),
    documentoOrigen: {
      tipo: TipoDocumentoOrigen.FACTURA,
      numero: 'F-100',
      fecha: hoy,
    },
    transportista: 'Juan Pérez',
    responsableComprobacion: 'Ana Gómez',
    lineas: [
      {
        producto: String(P1),
        contenedor: String(C1),
        cantidad: 10,
        costo_unitario: 2.5,
      },
      {
        producto: String(P2),
        contenedor: String(C1),
        cantidad: 4,
        costo_unitario: 0.1 + 0.2,
      },
    ],
    ...extra,
  });

  const usuario = {
    userId: 'u1',
    nombre: 'maria',
    rol: 'economico',
    modulos: [],
  };

  return {
    servicio,
    recepciones,
    consecutivo,
    empresa,
    existencia,
    registroCompra,
    A1,
    A2,
    C1,
    C2,
    P1,
    P2,
    PR,
    dto,
    usuario,
  };
}

describe('RecepcionService (SC-2-04)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('crear (borrador)', () => {
    it('guarda la cabecera normativa con el total calculado por el servidor y sin mover stock', async () => {
      const e = escenario();

      const r = await e.servicio.crear(e.dto(), e.usuario);

      expect(e.consecutivo.siguiente).toHaveBeenCalledWith('recepcion', 'REC');
      expect(r).toMatchObject({
        numeroConsecutivo: 'REC-000001',
        estado: EstadoRecepcion.BORRADOR,
        inventarioAplicado: false,
        entidadReceptora: { codigo: '01234567890', nombre: 'Xilef SA' },
        responsableRecepcion: 'maria',
        responsableComprobacion: 'Ana Gómez',
        transportista: 'Juan Pérez',
        documentoOrigen: {
          tipo: 'factura',
          numero: 'F-100',
          fecha: new Date('2026-10-05T12:00:00.000Z'),
        },
        total: 26.2,
      });
      expect(String(r.almacenReceptor)).toBe(String(e.A1));
      expect(String(r.proveedor)).toBe(String(e.PR));
      expect(r.lineas).toHaveLength(2);
      expect(r.lineas[0]).toMatchObject({
        cantidad: 10,
        costo_unitario: 2.5,
        total: 25,
      });
      expect(r.lineas[1]).toMatchObject({ cantidad: 4, total: 1.2 });
      expect(e.existencia.reponerProducto).not.toHaveBeenCalled();
      expect(e.registroCompra.registrarLinea).not.toHaveBeenCalled();
    });

    it('rechaza un proveedor, un almacén o un producto inexistentes sin consumir número', async () => {
      const e = escenario();
      const inexistente = String(new Types.ObjectId());

      await expect(
        e.servicio.crear(e.dto({ proveedor: inexistente }), e.usuario),
      ).rejects.toThrow(NotFoundException);
      await expect(
        e.servicio.crear(e.dto({ almacenReceptor: inexistente }), e.usuario),
      ).rejects.toThrow(NotFoundException);
      await expect(
        e.servicio.crear(
          e.dto({
            lineas: [
              {
                producto: inexistente,
                contenedor: String(e.C1),
                cantidad: 1,
                costo_unitario: 1,
              },
            ],
          }),
          e.usuario,
        ),
      ).rejects.toThrow('El producto no existe');
      expect(e.consecutivo.siguiente).not.toHaveBeenCalled();
      expect(e.recepciones.docs).toHaveLength(0);
    });

    it('rechaza un contenedor que no pertenece al almacén receptor', async () => {
      const e = escenario();

      await expect(
        e.servicio.crear(
          e.dto({
            lineas: [
              {
                producto: String(e.P1),
                contenedor: String(e.C2),
                cantidad: 1,
                costo_unitario: 1,
              },
            ],
          }),
          e.usuario,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(e.recepciones.docs).toHaveLength(0);
    });

    it('exige los datos de la empresa para la entidad receptora', async () => {
      const e = escenario();
      e.empresa.obtener.mockResolvedValue(null);

      await expect(e.servicio.crear(e.dto(), e.usuario)).rejects.toThrow(
        'datos de la empresa',
      );
      expect(e.recepciones.docs).toHaveLength(0);
    });
  });

  describe('actualizar (solo borrador)', () => {
    it('cambia la cabecera y las líneas y recalcula el total sin tocar el número ni el stock', async () => {
      const e = escenario();
      const creada = (await e.servicio.crear(
        e.dto(),
        e.usuario,
      )) as unknown as Recepcion & { _id: Types.ObjectId };

      const r = await e.servicio.actualizar(String(creada._id), {
        transportista: 'Otro',
        lineas: [
          {
            producto: String(e.P1),
            contenedor: String(e.C1),
            cantidad: 3,
            costo_unitario: 4,
          },
        ],
      });

      expect(r).toMatchObject({
        transportista: 'Otro',
        total: 12,
        numeroConsecutivo: 'REC-000001',
      });
      expect(r.lineas).toHaveLength(1);
      expect(e.existencia.reponerProducto).not.toHaveBeenCalled();
    });

    it('rechaza (409) editar una recepción ya registrada', async () => {
      const e = escenario();
      const creada = (await e.servicio.crear(
        e.dto(),
        e.usuario,
      )) as unknown as { _id: Types.ObjectId };
      await e.servicio.registrar(String(creada._id), e.usuario);

      await expect(
        e.servicio.actualizar(String(creada._id), { transportista: 'X' }),
      ).rejects.toThrow(ConflictException);
    });

    it('404 si no existe y 400 si el id no es válido', async () => {
      const e = escenario();
      await expect(
        e.servicio.actualizar(String(new Types.ObjectId()), {
          transportista: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(e.servicio.actualizar('x', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('registrar', () => {
    const crearBorrador = async (e: ReturnType<typeof escenario>) =>
      String(
        (
          (await e.servicio.crear(e.dto(), e.usuario)) as unknown as {
            _id: Types.ObjectId;
          }
        )._id,
      );

    it('mueve el saldo de cada línea al almacén receptor y escribe el kardex COMPRA con la referencia y el costo', async () => {
      const e = escenario();
      const id = await crearBorrador(e);

      const r = await e.servicio.registrar(id, e.usuario);

      expect(e.existencia.reponerProducto).toHaveBeenCalledTimes(2);
      expect(e.existencia.reponerProducto).toHaveBeenNthCalledWith(1, {
        productoId: String(e.P1),
        cantidad: 10,
        almacenId: String(e.A1),
        contenedorId: String(e.C1),
      });
      expect(e.registroCompra.registrarLinea).toHaveBeenCalledTimes(2);
      expect(e.registroCompra.registrarLinea).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          producto: String(e.P1),
          almacen: String(e.A1),
          contenedor: String(e.C1),
          cantidad: 10,
          costo_unitario: 2.5,
        }),
        expect.objectContaining({
          referencia: 'REC-000001',
          importeCUP: 25,
        }),
      );
      expect(r).toMatchObject({
        estado: EstadoRecepcion.REGISTRADA,
        inventarioAplicado: true,
        registradoPor: 'maria',
      });
      expect(r.fechaRegistro).toBeInstanceOf(Date);
    });

    it('es idempotente: registrar otra vez da 409 y no aplica el stock dos veces', async () => {
      const e = escenario();
      const id = await crearBorrador(e);
      await e.servicio.registrar(id, e.usuario);

      await expect(e.servicio.registrar(id, e.usuario)).rejects.toThrow(
        ConflictException,
      );

      expect(e.existencia.reponerProducto).toHaveBeenCalledTimes(2);
      expect(e.registroCompra.registrarLinea).toHaveBeenCalledTimes(2);
    });

    it('dos registros simultáneos: solo uno aplica el stock', async () => {
      const e = escenario();
      const id = await crearBorrador(e);

      const resultados = await Promise.allSettled([
        e.servicio.registrar(id, e.usuario),
        e.servicio.registrar(id, e.usuario),
      ]);

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(
        1,
      );
      expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(e.existencia.reponerProducto).toHaveBeenCalledTimes(2);
    });

    it('si falla una línea compensa las anteriores, deja el borrador editable y se puede reintentar una sola vez', async () => {
      const e = escenario();
      const id = await crearBorrador(e);
      const fallo = new Error('kardex caído');
      e.registroCompra.registrarLinea
        .mockImplementationOnce(() =>
          Promise.resolve({
            registro: { _id: new Types.ObjectId() },
            kardexId: 'k-1',
          }),
        )
        .mockImplementationOnce(() => Promise.reject(fallo));

      await expect(e.servicio.registrar(id, e.usuario)).rejects.toBe(fallo);

      // línea 1: compra y kardex descartados y stock devuelto; línea 2: solo stock devuelto.
      expect(e.registroCompra.descartarLinea).toHaveBeenCalledTimes(1);
      expect(e.registroCompra.descartarLinea).toHaveBeenCalledWith(
        expect.objectContaining({ kardexId: 'k-1' }),
      );
      expect(e.existencia.descontarProducto).toHaveBeenCalledTimes(2);
      expect(e.existencia.descontarProducto).toHaveBeenCalledWith({
        productoId: String(e.P1),
        cantidad: 10,
        almacenId: String(e.A1),
        contenedorId: String(e.C1),
      });
      const tras = e.recepciones.docs[0];
      expect(tras).toMatchObject({
        estado: EstadoRecepcion.BORRADOR,
        inventarioAplicado: false,
      });
      expect(tras.fechaRegistro).toBeUndefined();

      await e.servicio.registrar(id, e.usuario);
      expect(e.recepciones.docs[0]).toMatchObject({
        estado: EstadoRecepcion.REGISTRADA,
        inventarioAplicado: true,
      });
    });

    it('si falla la reposición de stock de una línea compensa las previas y propaga el error original', async () => {
      const e = escenario();
      const id = await crearBorrador(e);
      const fallo = new Error('sin conexión');
      e.existencia.reponerProducto
        .mockImplementationOnce((o) =>
          Promise.resolve({
            ubicaciones: [
              {
                almacen: o.almacenId,
                contenedor: o.contenedorId,
                cantidad: o.cantidad,
              },
            ],
            stockTotal: 10,
          }),
        )
        .mockImplementationOnce(() => Promise.reject(fallo));

      await expect(e.servicio.registrar(id, e.usuario)).rejects.toBe(fallo);

      expect(e.registroCompra.descartarLinea).toHaveBeenCalledTimes(1);
      expect(e.existencia.descontarProducto).toHaveBeenCalledTimes(1);
      expect(e.recepciones.docs[0]).toMatchObject({
        estado: EstadoRecepcion.BORRADOR,
        inventarioAplicado: false,
      });
    });

    it('si no se puede compensar, deja el documento reclamado (nunca aplica dos veces) y propaga el error original', async () => {
      const e = escenario();
      const id = await crearBorrador(e);
      const fallo = new Error('kardex caído');
      e.registroCompra.registrarLinea
        .mockImplementationOnce(() =>
          Promise.resolve({
            registro: { _id: new Types.ObjectId() },
            kardexId: 'k-1',
          }),
        )
        .mockImplementationOnce(() => Promise.reject(fallo));
      e.existencia.descontarProducto.mockRejectedValue(
        new Error('stock ya vendido'),
      );

      await expect(e.servicio.registrar(id, e.usuario)).rejects.toBe(fallo);

      expect(e.recepciones.docs[0]).toMatchObject({
        estado: EstadoRecepcion.REGISTRADA,
        inventarioAplicado: true,
      });
      await expect(e.servicio.registrar(id, e.usuario)).rejects.toThrow(
        ConflictException,
      );
    });

    it('404 si no existe y 400 si el id no es válido', async () => {
      const e = escenario();
      await expect(
        e.servicio.registrar(String(new Types.ObjectId()), e.usuario),
      ).rejects.toThrow(NotFoundException);
      await expect(e.servicio.registrar('x', e.usuario)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('consultas', () => {
    it('findOne devuelve la recepción y findAll filtra por estado', async () => {
      const e = escenario();
      const b = (await e.servicio.crear(e.dto(), e.usuario)) as unknown as {
        _id: Types.ObjectId;
      };
      await e.servicio.crear(e.dto(), e.usuario);
      await e.servicio.registrar(String(b._id), e.usuario);

      expect(await e.servicio.findOne(String(b._id))).toMatchObject({
        estado: 'registrada',
      });
      expect(
        await e.servicio.findAll({ estado: EstadoRecepcion.BORRADOR }),
      ).toHaveLength(1);
      expect(await e.servicio.findAll()).toHaveLength(2);
      await expect(
        e.servicio.findOne(String(new Types.ObjectId())),
      ).rejects.toThrow(NotFoundException);
      await expect(e.servicio.findOne('x')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
