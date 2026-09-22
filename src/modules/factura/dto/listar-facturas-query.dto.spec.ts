import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListarFacturasQueryDto } from './listar-facturas-query.dto';

describe('ListarFacturasQueryDto (T6)', () => {
  it('accepts no query params (both optional)', async () => {
    const instancia = plainToInstance(ListarFacturasQueryDto, {});
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('transforms and accepts valid page/limit strings (as they arrive from query params)', async () => {
    const instancia = plainToInstance(ListarFacturasQueryDto, {
      page: '2',
      limit: '50',
    });
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
    expect(instancia.page).toBe(2);
    expect(instancia.limit).toBe(50);
  });

  it('rejects page less than 1', async () => {
    const instancia = plainToInstance(ListarFacturasQueryDto, { page: '0' });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects a non-integer page', async () => {
    const instancia = plainToInstance(ListarFacturasQueryDto, {
      page: '1.5',
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects limit less than 1', async () => {
    const instancia = plainToInstance(ListarFacturasQueryDto, { limit: '0' });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects limit greater than 500', async () => {
    const instancia = plainToInstance(ListarFacturasQueryDto, {
      limit: '501',
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'limit')).toBe(true);
  });
});
