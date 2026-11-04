import { ConsecutivoService } from './consecutivo.service';

describe('ConsecutivoService', () => {
  const crearServicio = (seq: number) => {
    const exec = jest.fn().mockResolvedValue({ seq });
    const orFail = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ orFail });
    const service = new ConsecutivoService({ findOneAndUpdate } as never);
    return { service, findOneAndUpdate };
  };

  it('allocates the next number with an atomic $inc on the document type counter', async () => {
    const { service, findOneAndUpdate } = crearServicio(7);

    const numero = await service.siguiente('recepcion', 'REC');

    expect(numero).toBe('REC-000007');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'recepcion' },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
  });

  it('pads the number to six digits and keeps going past 999999', async () => {
    expect((await crearServicio(1).service.siguiente('ajuste', 'AJU')).endsWith('-000001')).toBe(true);
    expect(await crearServicio(1234567).service.siguiente('ajuste', 'AJU')).toBe('AJU-1234567');
  });
});
