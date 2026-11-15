import { ConflictException, NotFoundException } from '@nestjs/common';
import { KardexService } from './kardex.service';

function crearServicio(unificado: boolean) {
  const kardexModel = {
    findByIdAndDelete: jest.fn().mockResolvedValue({ _id: 'k1' }),
  };
  const existenciaService = {
    estaUnificado: jest.fn().mockResolvedValue(unificado),
  };
  const servicio = new KardexService(
    kardexModel as never,
    {} as never,
    {} as never,
    existenciaService as never,
  );
  return { servicio, kardexModel, existenciaService };
}

describe('KardexService.remove', () => {
  it('refuses with 409 in unified mode and deletes nothing', async () => {
    const { servicio, kardexModel } = crearServicio(true);

    const promesa = servicio.remove('k1');

    await expect(promesa).rejects.toBeInstanceOf(ConflictException);
    await expect(promesa).rejects.toThrow('no se eliminan');
    expect(kardexModel.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('keeps deleting the movement when stock is not unified', async () => {
    const { servicio, kardexModel } = crearServicio(false);

    await expect(servicio.remove('k1')).resolves.toEqual({
      message: 'El kardex se elimino correctamente',
    });
    expect(kardexModel.findByIdAndDelete).toHaveBeenCalledWith('k1');
  });

  it('keeps answering 404 for a missing movement when stock is not unified', async () => {
    const { servicio, kardexModel } = crearServicio(false);
    kardexModel.findByIdAndDelete.mockResolvedValue(null);

    await expect(servicio.remove('k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
