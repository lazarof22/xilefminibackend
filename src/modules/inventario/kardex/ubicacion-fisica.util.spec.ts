import { Types } from 'mongoose';
import { FakeModel } from '../exitencia/fake-mongo-spec';
import {
  formatearUbicacionFisica,
  ubicacionFisicaDe,
} from './ubicacion-fisica.util';

describe('formatearUbicacionFisica', () => {
  it('"<almacén> / <contenedor> / sección S · estante E · casilla C"', () => {
    expect(
      formatearUbicacionFisica({
        almacen: 'Central',
        contenedor: 'Estante Norte',
        seccion: 'B',
        estante: '3',
        casilla: '12',
      }),
    ).toBe('Central / Estante Norte / sección B · estante 3 · casilla 12');
  });

  it('omite las partes vacías', () => {
    expect(
      formatearUbicacionFisica({
        almacen: 'Central',
        contenedor: 'Estante Norte',
        estante: '3',
      }),
    ).toBe('Central / Estante Norte / estante 3');
    expect(
      formatearUbicacionFisica({
        almacen: 'Central',
        contenedor: 'Estante Norte',
        seccion: '  ',
      }),
    ).toBe('Central / Estante Norte');
    expect(formatearUbicacionFisica({ almacen: 'Central' })).toBe('Central');
  });

  it('es undefined si no hay ninguna parte', () => {
    expect(formatearUbicacionFisica({})).toBeUndefined();
  });
});

describe('ubicacionFisicaDe', () => {
  const almacenes = new FakeModel([{ nombreAlmacen: 'Central' }]);
  const A = almacenes.docs[0]._id as Types.ObjectId;
  const contenedores = new FakeModel([
    {
      nombreContenedor: 'Estante Norte',
      almacen: A,
      seccion: 'B',
      estante: '3',
      casilla: '12',
    },
  ]);
  const C = contenedores.docs[0]._id as Types.ObjectId;

  it('lee los nombres del almacén y del contenedor', async () => {
    expect(
      await ubicacionFisicaDe(almacenes as never, contenedores as never, A, C),
    ).toBe('Central / Estante Norte / sección B · estante 3 · casilla 12');
  });

  it('acepta ids en texto', async () => {
    expect(
      await ubicacionFisicaDe(
        almacenes as never,
        contenedores as never,
        A.toHexString(),
        C.toHexString(),
      ),
    ).toBe('Central / Estante Norte / sección B · estante 3 · casilla 12');
  });

  it('si el contenedor no existe, devuelve solo lo que encuentra', async () => {
    expect(
      await ubicacionFisicaDe(
        almacenes as never,
        contenedores as never,
        A,
        new Types.ObjectId(),
      ),
    ).toBe('Central');
  });

  it('sin ids devuelve undefined', async () => {
    expect(
      await ubicacionFisicaDe(almacenes as never, contenedores as never),
    ).toBeUndefined();
  });
});
