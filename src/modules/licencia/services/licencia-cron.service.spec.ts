import { Logger } from '@nestjs/common';
import { LicenciaCronService } from './licencia-cron.service';
import { LicenciaService } from '../licencia.service';

describe('LicenciaCronService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('re-derives every license from its signed payload', async () => {
    const reevaluarTodas = jest
      .fn()
      .mockResolvedValue({ valida: 1, expirada: 2 });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await new LicenciaCronService({
      reevaluarTodas,
    } as unknown as LicenciaService).reevaluar();
    expect(reevaluarTodas).toHaveBeenCalled();
  });

  it('logs and does not crash on failure', async () => {
    const reevaluarTodas = jest.fn().mockRejectedValue(new Error('down'));
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await new LicenciaCronService({
      reevaluarTodas,
    } as unknown as LicenciaService).reevaluar();
    expect(spy).toHaveBeenCalled();
  });
});
