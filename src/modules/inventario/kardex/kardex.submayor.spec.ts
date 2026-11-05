import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { KardexService } from './kardex.service';
import { KardexTipo } from './schema/kardex.schema';
import { CreateKardexDto } from './dto/create-kardex.dto';
import { ExistenciaService } from '../exitencia/existencia.service';
import { FakeModel } from '../exitencia/fake-mongo-spec';

/**
 * Submayor SC-2-13: el ajuste manual (KardexService.create) registra el costo
 * promedio VIGENTE del producto y su importe en CUP, sin cambiar el promedio.
 */
function escenario(opciones: { unificado: boolean; precioCompra?: number }) {
  const almacenes = new FakeModel([{ nombreAlmacen: 'Central' }]);
  const A = almacenes.docs[0]._id as Types.ObjectId;
  const contenedores = new FakeModel([
    { nombreContenedor: 'Estante 1', almacen: A },
  ]);
  const C = contenedores.docs[0]._id as Types.ObjectId;
  const productos = new FakeModel([
    {
      codigo_producto: 'ARR-1',
      nombre_producto: 'Arroz',
      stock_inicial: 10,
      precio_compra: opciones.precioCompra,
      almacen: A,
      contenedor: C,
    },
  ]);
  const P = productos.docs[0]._id as Types.ObjectId;
  const existencias = new FakeModel([
    { producto: P, almacen: A, contenedor: C, cantidad: 10 },
  ]);
  const config = new FakeModel(
    opciones.unificado
      ? [{ clave: 'inventario', existenciasUnificadas: true }]
      : [],
  );
  const kardex = new FakeModel();
  const nomencladorHelper = {
    findOrCreateEstado: jest.fn().mockResolvedValue(new Types.ObjectId()),
  };
  const existenciaService = new ExistenciaService(
    existencias as never,
    productos as never,
    almacenes as never,
    contenedores as never,
    config as never,
  );
  jest.spyOn(existenciaService, 'estaUnificado').mockResolvedValue(
    opciones.unificado,
  );
  const servicio = new KardexService(
    kardex as never,
    productos as never,
    nomencladorHelper as never,
    existenciaService,
  );

  const dto = (extra: Partial<CreateKardexDto>): CreateKardexDto => ({
    productoId: String(P),
    tipo: KardexTipo.SALIDA,
    cantidad: 1,
    motivo: 'Ajuste de prueba',
    ...extra,
  });

  return { servicio, kardex, P, A, C, dto };
}

describe.each([
  ['antes de unificar', false],
  ['con existencias unificadas', true],
])('KardexService.create — Submayor SC-2-13 (%s)', (_nombre, unificado) => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('una salida registra el último promedio del kardex y cantidad × promedio, sin cambiarlo', async () => {
    const e = escenario({ unificado, precioCompra: 9 });
    e.kardex.insertar({ productoId: e.P, costoPromedio: 6.5 });

    const fila = await e.servicio.create(
      e.dto({ tipo: KardexTipo.SALIDA, cantidad: 3 }),
    );

    expect(fila.costoPromedio).toBe(6.5);
    expect(fila.importeCUP).toBe(19.5);
    // El promedio vigente sigue siendo el mismo para el siguiente movimiento.
    const otra = await e.servicio.create(
      e.dto({ tipo: KardexTipo.SALIDA, cantidad: 2 }),
    );
    expect(otra.costoPromedio).toBe(6.5);
    expect(otra.importeCUP).toBe(13);
  });

  it('una entrada manual (sin costo propio) también se valúa al promedio vigente', async () => {
    const e = escenario({ unificado });
    e.kardex.insertar({ productoId: e.P, costoPromedio: 2 });

    const fila = await e.servicio.create(
      e.dto({ tipo: KardexTipo.ENTRADA, cantidad: 4 }),
    );

    expect(fila.costoPromedio).toBe(2);
    expect(fila.importeCUP).toBe(8);
  });

  it('sin promedio en el kardex usa Producto.precio_compra', async () => {
    const e = escenario({ unificado, precioCompra: 4.25 });

    const fila = await e.servicio.create(
      e.dto({ tipo: KardexTipo.SALIDA, cantidad: 2 }),
    );

    expect(fila.costoPromedio).toBe(4.25);
    expect(fila.importeCUP).toBe(8.5);
  });

  it('sin promedio ni precio_compra no inventa costo ni importe', async () => {
    const e = escenario({ unificado });

    const fila = await e.servicio.create(
      e.dto({ tipo: KardexTipo.SALIDA, cantidad: 2 }),
    );

    expect(fila.costoPromedio).toBeUndefined();
    expect(fila.importeCUP).toBeUndefined();
    expect(fila.importeDivisa).toBeUndefined();
    expect(fila.referenciaContable).toBeUndefined();
  });

  it('lo que trae el DTO tiene prioridad sobre el cálculo', async () => {
    const e = escenario({ unificado });
    e.kardex.insertar({ productoId: e.P, costoPromedio: 6.5 });

    const fila = await e.servicio.create(
      e.dto({
        cantidad: 3,
        costoPromedio: 7,
        importeCUP: 21,
        ubicacionFisica: 'Central / Estante 1',
      }),
    );

    expect(fila).toMatchObject({
      costoPromedio: 7,
      importeCUP: 21,
      ubicacionFisica: 'Central / Estante 1',
    });
  });
});
