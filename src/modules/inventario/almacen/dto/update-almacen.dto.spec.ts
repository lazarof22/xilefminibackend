import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAlmacenDto } from './update-almacen.dto';

describe('UpdateAlmacenDto (T2)', () => {
  it('has codigo as optional', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, {});
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('accepts a valid codigo update', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, { codigo: 'ALM-002' });
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('rejects an empty codigo when sent', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, { codigo: '' });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigo')).toBe(true);
  });

  it('rejects a codigo longer than 20 characters', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, {
      codigo: 'A'.repeat(21),
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigo')).toBe(true);
  });
});
