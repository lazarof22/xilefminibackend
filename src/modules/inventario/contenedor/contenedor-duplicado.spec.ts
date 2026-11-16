import { ConflictException } from '@nestjs/common';
import { ContenedorService } from './contenedor.service';

/** A duplicate contenedor code is a 409 with a readable message, not a 500. */
describe('ContenedorService.create — código duplicado', () => {
  const dto = {
    codigoContenedor: 'CON-1',
    nombreContenedor: 'Contenedor 1',
    almacen: '64b000000000000000000001',
  };

  function servicio(guardar: () => Promise<unknown>) {
    const contenedorModel = Object.assign(
      jest.fn().mockImplementation(() => ({ save: guardar })),
      { findOne: jest.fn().mockResolvedValue(null) },
    );
    const almacenModel = {
      findById: jest.fn(() => ({ exec: () => Promise.resolve({ _id: 'a' }) })),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    return {
      servicio: new ContenedorService(
        contenedorModel as never,
        almacenModel as never,
      ),
      almacenModel,
    };
  }

  it('answers 409 when Mongo rejects the unique index (E11000)', async () => {
    const { servicio: s, almacenModel } = servicio(() =>
      Promise.reject({ code: 11000 }),
    );

    await expect(s.create(dto as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(almacenModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('lets any other error through untouched', async () => {
    const { servicio: s } = servicio(() => Promise.reject(new Error('boom')));

    await expect(s.create(dto as never)).rejects.toThrow('boom');
  });
});
