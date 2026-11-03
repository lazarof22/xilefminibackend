import { Types } from 'mongoose';
import {
  fusionarUbicaciones,
  ordenarPorPolitica,
  planificarDescuento,
} from './existencia-asignacion';
import { FilaExistencia } from './existencia.types';

const id = () => new Types.ObjectId();
const alm = id();
const otroAlm = id();
const contA = id();
const contB = id();
const contC = id();

const fila = (
  contenedor: Types.ObjectId,
  cantidad: number,
  almacen = alm,
): FilaExistencia => ({ _id: id(), almacen, contenedor, cantidad });

/** "contenedor:cantidad" por asignación, para comparar sin depender de ObjectId. */
const resumen = (
  asignaciones: { contenedor: Types.ObjectId; cantidad: number }[],
) => asignaciones.map((a) => `${String(a.contenedor)}:${a.cantidad}`);

describe('ordenarPorPolitica', () => {
  it('pone primero la ubicación por defecto aunque tenga menos stock', () => {
    const filas = [fila(contA, 9), fila(contB, 2), fila(contC, 5)];

    const orden = ordenarPorPolitica(filas, {
      almacen: alm,
      contenedor: contB,
    });

    expect(orden.map((f) => String(f.contenedor))).toEqual([
      String(contB),
      String(contA),
      String(contC),
    ]);
  });

  it('sin ubicación por defecto ordena de más a menos stock', () => {
    const filas = [fila(contA, 1), fila(contB, 8), fila(contC, 4)];

    const orden = ordenarPorPolitica(filas);

    expect(orden.map((f) => f.cantidad)).toEqual([8, 4, 1]);
  });

  it('a igual cantidad desempata por id, siempre igual', () => {
    const a = fila(contA, 3);
    const b = fila(contB, 3);

    const uno = ordenarPorPolitica([a, b]);
    const dos = ordenarPorPolitica([b, a]);

    expect(uno.map((f) => String(f._id))).toEqual(
      dos.map((f) => String(f._id)),
    );
  });

  it('no confunde un contenedor igual de otro almacén con la ubicación por defecto', () => {
    const delOtroAlmacen = fila(contA, 1, otroAlm);
    const delAlmacen = fila(contB, 5);

    const orden = ordenarPorPolitica([delAlmacen, delOtroAlmacen], {
      almacen: otroAlm,
      contenedor: contA,
    });

    expect(orden[0]).toBe(delOtroAlmacen);
  });

  it('no modifica el arreglo recibido', () => {
    const filas = [fila(contA, 1), fila(contB, 8)];
    const copia = [...filas];

    ordenarPorPolitica(filas);

    expect(filas).toEqual(copia);
  });
});

describe('planificarDescuento', () => {
  it('toma todo de una sola fila si alcanza', () => {
    const plan = planificarDescuento([fila(contA, 10)], 4);

    expect(resumen(plan.asignaciones)).toEqual([`${String(contA)}:4`]);
    expect(plan.faltante).toBe(0);
  });

  it('reparte entre filas: primero la por defecto, luego la de más stock', () => {
    const filas = [fila(contA, 2), fila(contB, 6), fila(contC, 4)];

    const plan = planificarDescuento(filas, 9, {
      almacen: alm,
      contenedor: contA,
    });

    expect(resumen(plan.asignaciones)).toEqual([
      `${String(contA)}:2`,
      `${String(contB)}:6`,
      `${String(contC)}:1`,
    ]);
    expect(plan.faltante).toBe(0);
  });

  it('informa el faltante cuando no alcanza', () => {
    const plan = planificarDescuento([fila(contA, 3), fila(contB, 2)], 7);

    expect(plan.asignaciones.reduce((s, a) => s + a.cantidad, 0)).toBe(5);
    expect(plan.faltante).toBe(2);
  });

  it('sin filas no asigna nada y el faltante es todo', () => {
    const plan = planificarDescuento([], 3);

    expect(plan.asignaciones).toEqual([]);
    expect(plan.faltante).toBe(3);
  });

  it('ignora filas sin stock', () => {
    const plan = planificarDescuento([fila(contA, 0), fila(contB, 2)], 2);

    expect(resumen(plan.asignaciones)).toEqual([`${String(contB)}:2`]);
  });

  it('no arrastra residuos de decimales (0.1 + 0.2)', () => {
    const plan = planificarDescuento([fila(contA, 0.1), fila(contB, 0.2)], 0.3);

    expect(plan.faltante).toBe(0);
    expect(plan.asignaciones.map((a) => a.cantidad)).toEqual([0.2, 0.1]);
  });

  it('acepta un saldo con residuo binario como si fuera exacto', () => {
    // 0.7 − 0.4 = 0.29999999999999993 en coma flotante.
    const plan = planificarDescuento([fila(contA, 0.7 - 0.4)], 0.3);

    expect(plan.faltante).toBe(0);
    expect(plan.asignaciones.map((a) => a.cantidad)).toEqual([0.3]);
  });

  it('conserva el id de la existencia para el descuento atómico', () => {
    const f = fila(contA, 5);

    const plan = planificarDescuento([f], 1);

    expect(plan.asignaciones[0].existenciaId).toBe(f._id);
  });
});

describe('fusionarUbicaciones', () => {
  it('suma las cantidades de la misma ubicación', () => {
    const fusion = fusionarUbicaciones([
      { almacen: alm, contenedor: contA, cantidad: 1 },
      { almacen: alm, contenedor: contA, cantidad: 2.5 },
      { almacen: alm, contenedor: contB, cantidad: 4 },
    ]);

    expect(resumen(fusion)).toEqual([
      `${String(contA)}:3.5`,
      `${String(contB)}:4`,
    ]);
  });

  it('distingue el mismo contenedor en almacenes distintos', () => {
    const fusion = fusionarUbicaciones([
      { almacen: alm, contenedor: contA, cantidad: 1 },
      { almacen: otroAlm, contenedor: contA, cantidad: 1 },
    ]);

    expect(fusion).toHaveLength(2);
  });

  it('una lista vacía da una lista vacía', () => {
    expect(fusionarUbicaciones([])).toEqual([]);
  });
});
