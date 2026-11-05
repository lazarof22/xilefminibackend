import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';
import { ExistenciaService } from '../exitencia/existencia.service';
import { FakeModel } from '../exitencia/fake-mongo-spec';
import { KardexService } from '../kardex/kardex.service';
import { AjusteInventarioService } from './ajuste-inventario.service';
import { CreateAjusteInventarioDto } from './dto/create-ajuste-inventario.dto';

/**
 * Producto "Arroz" (10): Central / Estante 1 = 6, Central / Estante 2 = 3,
 * Tienda / Vitrina = 1. Producto "Frijol" (4) en Estante 1.
 */
function escenario() {
  const almacenes = new FakeModel([
    { nombreAlmacen: 'Central' },
    { nombreAlmacen: 'Tienda' },
  ]);
  const [A1, A2] = almacenes.docs.map((d) => d._id as Types.ObjectId);
  const contenedores = new FakeModel([
    {
      nombreContenedor: 'Estante 1',
      almacen: A1,
      seccion: 'B',
      estante: '3',
      casilla: '12',
    },
    { nombreContenedor: 'Estante 2', almacen: A1 },
    { nombreContenedor: 'Vitrina', almacen: A2 },
  ]);
  const [C1, C2, C3] = contenedores.docs.map((d) => d._id as Types.ObjectId);
  const productos = new FakeModel([
    {
      codigo_producto: 'ARR-1',
      nombre_producto: 'Arroz',
      stock_inicial: 10,
      almacen: A1,
      contenedor: C1,
    },
    {
      codigo_producto: 'FRI-1',
      nombre_producto: 'Frijol',
      stock_inicial: 4,
      almacen: A1,
      contenedor: C1,
    },
  ]);
  const [P, P2] = productos.docs.map((d) => d._id as Types.ObjectId);
  const existencias = new FakeModel([
    { producto: P, almacen: A1, contenedor: C1, cantidad: 6 },
    { producto: P, almacen: A1, contenedor: C2, cantidad: 3 },
    { producto: P, almacen: A2, contenedor: C3, cantidad: 1 },
    { producto: P2, almacen: A1, contenedor: C1, cantidad: 4 },
  ]);
  const kardex = new FakeModel();
  const ajustes = new FakeModel();
  const nomencladorHelper = {
    findOrCreateEstado: jest.fn().mockResolvedValue(new Types.ObjectId()),
  };
  const existenciaService = new ExistenciaService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    new FakeModel() as never,
  );
  const kardexService = new KardexService(
    kardex as never,
    productos as never,
    nomencladorHelper as never,
    existenciaService,
  );
  const consecutivo = { siguiente: jest.fn().mockResolvedValue('AJU-000001') };
  const causas = {
    findAll: jest
      .fn()
      .mockResolvedValue([
        { nombre_causa: 'Pérdida' },
        { nombre_causa: 'Producto dañado' },
      ]),
  };
  const servicio = new AjusteInventarioService(
    ajustes as never,
    productos as never,
    contenedores as never,
    existencias as never,
    consecutivo as never,
    causas as never,
    existenciaService,
    kardexService,
    almacenes as never,
  );

  const linea = (
    p: Types.ObjectId,
    a: Types.ObjectId,
    c: Types.ObjectId,
    ajuste: number,
  ) => ({
    producto: String(p),
    almacen: String(a),
    contenedor: String(c),
    ajuste,
  });
  const dto = (
    extra: Partial<CreateAjusteInventarioDto> = {},
  ): CreateAjusteInventarioDto => ({
    causa: 'Pérdida',
    autorizadoPor: 'Laura Gerente',
    firmadoPor: 'Pedro Almacén',
    lineas: [linea(P, A1, C1, -2)],
    ...extra,
  });
  const usuario = (rol = 'economico') => ({
    userId: 'u1',
    nombre: 'maria',
    rol,
    modulos: [],
  });
  const saldo = (p: Types.ObjectId, c: Types.ObjectId) =>
    existencias.docs.find(
      (d) =>
        String(d.producto) === String(p) && String(d.contenedor) === String(c),
    )?.cantidad as number | undefined;

  return {
    servicio,
    ajustes,
    kardex,
    productos,
    existencias,
    existenciaService,
    consecutivo,
    causas,
    A1,
    A2,
    C1,
    C2,
    C3,
    P,
    P2,
    linea,
    dto,
    usuario,
    saldo,
    stock: (p: Types.ObjectId = P) =>
      productos.docs.find((d) => String(d._id) === String(p))
        ?.stock_inicial as number,
  };
}

describe('AjusteInventarioService (SC-2-16)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('ajuste con el modo unificado', () => {
    it('lee el saldo de Existencia, calcula el saldo después, mueve el stock y deja el kardex con la referencia', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      const r = await e.servicio.crear(e.dto(), e.usuario());

      expect(e.consecutivo.siguiente).toHaveBeenCalledWith('ajuste', 'AJU');
      expect(r).toMatchObject({
        numeroConsecutivo: 'AJU-000001',
        causa: 'Pérdida',
        autorizadoPor: 'Laura Gerente',
        firmadoPor: 'Pedro Almacén',
        registradoPor: 'maria',
      });
      expect(r.lineas).toHaveLength(1);
      expect(r.lineas[0]).toMatchObject({
        saldoAntes: 6,
        ajuste: -2,
        saldoDespues: 4,
      });
      expect(e.saldo(e.P, e.C1)).toBe(4);
      expect(e.stock()).toBe(8);
      expect(e.kardex.docs).toHaveLength(1);
      expect(e.kardex.docs[0]).toMatchObject({
        tipo: 'salida',
        cantidad: 2,
        stock: 8,
        referencia: 'AJU-000001',
      });
      expect(String(e.kardex.docs[0].motivo)).toContain('Pérdida');
      expect(String(e.kardex.docs[0].motivo)).toContain('6');
      expect(String(e.kardex.docs[0].motivo)).toContain('4');
      expect(e.ajustes.docs).toHaveLength(1);
    });

    it('acepta el DTO tal como llega del ValidationPipe: instancias de clase con saldoAntes/saldoDespues sin definir', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      // `plainToInstance` crea las propiedades `saldoAntes`/`saldoDespues` con
      // valor `undefined` (campos de clase): `'saldoAntes' in linea` es true.
      const dto = plainToInstance(CreateAjusteInventarioDto, e.dto());
      expect('saldoAntes' in dto.lineas[0]).toBe(true);

      const r = await e.servicio.crear(dto, e.usuario());

      expect(r.lineas[0]).toMatchObject({ saldoAntes: 6, saldoDespues: 4 });
      expect(e.stock()).toBe(8);
    });

    it('un aumento acepta una causa libre, la entrada va a la ubicación indicada', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      const r = await e.servicio.crear(
        e.dto({
          causa: 'Sobrante en conteo',
          lineas: [e.linea(e.P, e.A2, e.C3, 3)],
        }),
        e.usuario('administrador'),
      );

      expect(r.lineas[0]).toMatchObject({
        saldoAntes: 1,
        ajuste: 3,
        saldoDespues: 4,
      });
      expect(e.saldo(e.P, e.C3)).toBe(4);
      expect(e.kardex.docs[0]).toMatchObject({
        tipo: 'entrada',
        cantidad: 3,
        referencia: 'AJU-000001',
      });
    });

    it('un aumento en una ubicación sin existencia parte de saldo 0', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      const r = await e.servicio.crear(
        e.dto({ causa: 'Hallazgo', lineas: [e.linea(e.P2, e.A2, e.C3, 5)] }),
        e.usuario(),
      );

      expect(r.lineas[0]).toMatchObject({ saldoAntes: 0, saldoDespues: 5 });
      expect(e.saldo(e.P2, e.C3)).toBe(5);
    });

    it('lee el saldo aunque la fila de existencia guarde el id de producto como texto', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      e.existencias.docs[0].producto = String(e.P);

      const r = await e.servicio.crear(
        e.dto({ lineas: [e.linea(e.P, e.A1, e.C1, -1)] }),
        e.usuario(),
      );

      expect(r.lineas[0].saldoAntes).toBe(6);
    });

    it('dos líneas de la misma ubicación en un documento encadenan el saldo', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      const r = await e.servicio.crear(
        e.dto({
          lineas: [e.linea(e.P, e.A1, e.C1, -2), e.linea(e.P, e.A1, e.C1, -3)],
        }),
        e.usuario(),
      );

      expect(r.lineas.map((l) => [l.saldoAntes, l.saldoDespues])).toEqual([
        [6, 4],
        [4, 1],
      ]);
      expect(e.saldo(e.P, e.C1)).toBe(1);
    });
  });

  describe('ajuste antes de unificar', () => {
    it('toma el saldo del stock del producto, que es lo que mueve el kardex', async () => {
      const e = escenario();

      const r = await e.servicio.crear(e.dto(), e.usuario());

      expect(r.lineas[0]).toMatchObject({
        saldoAntes: 10,
        ajuste: -2,
        saldoDespues: 8,
      });
      expect(e.stock()).toBe(8);
      expect(e.saldo(e.P, e.C1)).toBe(6);
      expect(e.kardex.docs[0]).toMatchObject({
        referencia: 'AJU-000001',
        stock: 8,
      });
    });
  });

  describe('no permite el ajuste silencioso', () => {
    it.each([
      ['causa', { causa: '   ' }],
      ['autorizadoPor', { autorizadoPor: '' }],
      ['firmadoPor', { firmadoPor: '  ' }],
    ])('rechaza un ajuste sin %s y no mueve nada', async (_campo, cambio) => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.crear(e.dto(cambio), e.usuario()),
      ).rejects.toThrow(BadRequestException);

      expect(e.stock()).toBe(10);
      expect(e.kardex.docs).toHaveLength(0);
      expect(e.ajustes.docs).toHaveLength(0);
      expect(e.consecutivo.siguiente).not.toHaveBeenCalled();
    });

    it('una disminución exige una causa del nomenclador (sin distinguir mayúsculas)', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.crear(e.dto({ causa: 'Porque sí' }), e.usuario()),
      ).rejects.toThrow('nomenclador');
      expect(e.stock()).toBe(10);
      expect(e.ajustes.docs).toHaveLength(0);

      await e.servicio.crear(
        e.dto({ causa: '  producto DAÑADO ' }),
        e.usuario(),
      );
      expect(e.stock()).toBe(8);
    });

    it('rechaza saldos enviados por el cliente', async () => {
      const e = escenario();
      const conSaldo = e.dto({
        lineas: [
          {
            ...e.linea(e.P, e.A1, e.C1, -2),
            saldoAntes: 6,
            saldoDespues: 4,
          } as never,
        ],
      });

      await expect(e.servicio.crear(conSaldo, e.usuario())).rejects.toThrow(
        'servidor',
      );
      expect(e.kardex.docs).toHaveLength(0);
    });

    it('rechaza un ajuste en cero', async () => {
      const e = escenario();
      await expect(
        e.servicio.crear(
          e.dto({ lineas: [e.linea(e.P, e.A1, e.C1, 0)] }),
          e.usuario(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un documento sin líneas', async () => {
      const e = escenario();
      await expect(
        e.servicio.crear(e.dto({ lineas: [] }), e.usuario()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un saldo después negativo sin aplicar ninguna línea', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');

      await expect(
        e.servicio.crear(
          e.dto({
            lineas: [
              e.linea(e.P, e.A1, e.C1, -2),
              e.linea(e.P, e.A1, e.C2, -4),
            ],
          }),
          e.usuario(),
        ),
      ).rejects.toThrow(BadRequestException);

      expect(e.saldo(e.P, e.C1)).toBe(6);
      expect(e.saldo(e.P, e.C2)).toBe(3);
      expect(e.kardex.docs).toHaveLength(0);
      expect(e.ajustes.docs).toHaveLength(0);
    });

    it('solo administrador y económico pueden ajustar', async () => {
      const e = escenario();
      for (const rol of ['gerente', 'cajero', 'facturador', 'empleado']) {
        await expect(e.servicio.crear(e.dto(), e.usuario(rol))).rejects.toThrow(
          ForbiddenException,
        );
      }
      expect(e.kardex.docs).toHaveLength(0);
    });
  });

  describe('Submayor SC-2-13 en el kardex del ajuste', () => {
    it('registra la ubicación física del movimiento y el costo promedio vigente × cantidad', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      e.kardex.insertar({ productoId: e.P, costoPromedio: 6.5 });

      await e.servicio.crear(e.dto(), e.usuario());

      const fila = e.kardex.docs[1];
      expect(fila).toMatchObject({
        tipo: 'salida',
        cantidad: 2,
        costoPromedio: 6.5,
        importeCUP: 13,
        ubicacionFisica: 'Central / Estante 1 / sección B · estante 3 · casilla 12',
      });
      expect(fila).not.toHaveProperty('referenciaContable');
      expect(fila).not.toHaveProperty('importeDivisa');
    });

    it('un ajuste positivo se valúa igual al promedio vigente (no lo cambia) y en el modo anterior también', async () => {
      const e = escenario();
      e.productos.docs[0].precio_compra = 5;

      await e.servicio.crear(
        e.dto({ lineas: [e.linea(e.P, e.A1, e.C1, 3)] }),
        e.usuario(),
      );

      expect(e.kardex.docs[0]).toMatchObject({
        tipo: 'entrada',
        costoPromedio: 5,
        importeCUP: 15,
        ubicacionFisica: 'Central / Estante 1 / sección B · estante 3 · casilla 12',
      });
    });

    it('la reversión de un ajuste que no se completó también lleva su ubicación', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      const original = e.kardex.create.bind(e.kardex) as (
        d: Record<string, unknown>,
      ) => Promise<unknown>;
      let n = 0;
      e.kardex.create = ((d: Record<string, unknown>) =>
        ++n === 2
          ? Promise.reject(new Error('kardex caído'))
          : original(d)) as never;

      await expect(
        e.servicio.crear(
          e.dto({
            lineas: [e.linea(e.P, e.A1, e.C1, -1), e.linea(e.P, e.A1, e.C2, -1)],
          }),
          e.usuario(),
        ),
      ).rejects.toThrow('kardex caído');

      const reversion = e.kardex.docs.find((d) =>
        String(d.motivo).startsWith('Reversión'),
      );
      expect(reversion?.ubicacionFisica).toBe(
        'Central / Estante 1 / sección B · estante 3 · casilla 12',
      );
    });
  });

  describe('referencias', () => {
    it('rechaza un producto o un contenedor inexistente, o de otro almacén', async () => {
      const e = escenario();
      const nada = new Types.ObjectId();
      await expect(
        e.servicio.crear(
          e.dto({ lineas: [e.linea(nada, e.A1, e.C1, -1)] }),
          e.usuario(),
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        e.servicio.crear(
          e.dto({ lineas: [e.linea(e.P, e.A1, nada, -1)] }),
          e.usuario(),
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        e.servicio.crear(
          e.dto({ lineas: [e.linea(e.P, e.A1, e.C3, -1)] }),
          e.usuario(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(e.kardex.docs).toHaveLength(0);
    });
  });

  describe('fallos a mitad del documento', () => {
    it('si una línea posterior falla, compensa las anteriores con movimientos inversos y no guarda el documento', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      const fallo = new Error('kardex caído');
      const original = e.kardex.create.bind(e.kardex) as (
        datos: Record<string, unknown>,
      ) => Promise<unknown>;
      let llamadas = 0;
      jest
        .spyOn(e.kardex, 'create')
        .mockImplementation((datos: Record<string, unknown>) => {
          llamadas += 1;
          return llamadas === 2 ? Promise.reject(fallo) : original(datos);
        });

      await expect(
        e.servicio.crear(
          e.dto({
            lineas: [
              e.linea(e.P, e.A1, e.C1, -2),
              e.linea(e.P, e.A1, e.C2, -1),
            ],
          }),
          e.usuario(),
        ),
      ).rejects.toBe(fallo);

      expect(e.saldo(e.P, e.C1)).toBe(6);
      expect(e.saldo(e.P, e.C2)).toBe(3);
      expect(e.stock()).toBe(10);
      expect(e.ajustes.docs).toHaveLength(0);
      // la salida original y su reversión (entrada) quedan en el kardex como evidencia
      expect(e.kardex.docs.map((d) => String(d.tipo))).toEqual([
        'salida',
        'entrada',
      ]);
      expect(String(e.kardex.docs[1].motivo)).toContain('Reversión');
      expect(e.kardex.docs[1].referencia).toBe('AJU-000001');
    });

    it('si no se puede guardar el documento, deshace todas las líneas', async () => {
      const e = escenario();
      await e.existenciaService.activarModoUnificado('admin');
      const fallo = new Error('base caída');
      jest.spyOn(e.ajustes, 'create').mockRejectedValue(fallo);

      await expect(e.servicio.crear(e.dto(), e.usuario())).rejects.toBe(fallo);

      expect(e.saldo(e.P, e.C1)).toBe(6);
      expect(e.stock()).toBe(10);
    });
  });

  describe('consultas', () => {
    it('findAll lista y findOne devuelve un ajuste; 404 y 400 en los casos malos', async () => {
      const e = escenario();
      const r = (await e.servicio.crear(e.dto(), e.usuario())) as unknown as {
        _id: Types.ObjectId;
      };

      expect(await e.servicio.findAll()).toHaveLength(1);
      expect(await e.servicio.findOne(String(r._id))).toMatchObject({
        numeroConsecutivo: 'AJU-000001',
      });
      await expect(
        e.servicio.findOne(String(new Types.ObjectId())),
      ).rejects.toThrow(NotFoundException);
      await expect(e.servicio.findOne('x')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
