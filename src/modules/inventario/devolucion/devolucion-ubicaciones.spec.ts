import { Types } from 'mongoose';
import {
  fusionarOrigen,
  repartirEnUbicaciones,
} from './devolucion-ubicaciones';

const A = new Types.ObjectId();
const C1 = new Types.ObjectId();
const C2 = new Types.ObjectId();

const origen = [
  { almacen: A, contenedor: C1, cantidad: 3 },
  { almacen: A, contenedor: C2, cantidad: 2 },
];

describe('repartirEnUbicaciones', () => {
  it('devuelve primero a la ubicación original de la que salió más', () => {
    const r = repartirEnUbicaciones(origen, 0, 2);
    expect(r.ubicaciones).toEqual([
      { almacen: A, contenedor: C1, cantidad: 2 },
    ]);
    expect(r.resto).toBe(0);
  });

  it('cruza de una ubicación a la siguiente', () => {
    const r = repartirEnUbicaciones(origen, 0, 4);
    expect(r.ubicaciones).toEqual([
      { almacen: A, contenedor: C1, cantidad: 3 },
      { almacen: A, contenedor: C2, cantidad: 1 },
    ]);
  });

  it('salta lo ya devuelto antes para no pasarse de lo que salió de cada ubicación', () => {
    const r = repartirEnUbicaciones(origen, 3, 2);
    expect(r.ubicaciones).toEqual([
      { almacen: A, contenedor: C2, cantidad: 2 },
    ]);

    const parcial = repartirEnUbicaciones(origen, 2, 2);
    expect(parcial.ubicaciones).toEqual([
      { almacen: A, contenedor: C1, cantidad: 1 },
      { almacen: A, contenedor: C2, cantidad: 1 },
    ]);
  });

  it('sin ubicaciones de origen todo queda como resto (política por defecto)', () => {
    expect(repartirEnUbicaciones([], 0, 2)).toEqual({
      ubicaciones: [],
      resto: 2,
    });
  });

  it('lo que excede las ubicaciones conocidas queda como resto', () => {
    const r = repartirEnUbicaciones(origen, 4, 3);
    expect(r.ubicaciones).toEqual([
      { almacen: A, contenedor: C2, cantidad: 1 },
    ]);
    expect(r.resto).toBe(2);
  });

  it('admite fracciones sin arrastrar residuos binarios', () => {
    const r = repartirEnUbicaciones(
      [{ almacen: A, contenedor: C1, cantidad: 0.7 }],
      0.4,
      0.3,
    );
    expect(r.ubicaciones).toEqual([
      { almacen: A, contenedor: C1, cantidad: 0.3 },
    ]);
    expect(r.resto).toBe(0);
  });
});

describe('fusionarOrigen', () => {
  it('suma ubicaciones repetidas e ignora cantidades no positivas', () => {
    const r = fusionarOrigen([
      { almacen: A, contenedor: C1, cantidad: 1 },
      { almacen: String(A), contenedor: String(C1), cantidad: 2 },
      { almacen: A, contenedor: C2, cantidad: 0 },
    ]);
    expect(r).toEqual([{ almacen: A, contenedor: C1, cantidad: 3 }]);
  });
});
