import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAlmacenDto } from './update-almacen.dto';

describe('UpdateAlmacenDto (T2)', () => {
  it('has codigoAlmacen as optional', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, {});
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('accepts a valid codigoAlmacen update', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, { codigoAlmacen: 'ALM-002' });
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('rejects an empty codigoAlmacen when sent', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, { codigoAlmacen: '' });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('rejects a codigoAlmacen longer than 20 characters', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, {
      codigoAlmacen: 'A'.repeat(21),
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('rejects a whitespace-only codigoAlmacen', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, { codigoAlmacen: '   ' });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('trims surrounding whitespace from a valid codigoAlmacen update', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, {
      codigoAlmacen: '  ALM-002  ',
    });
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
    expect(instancia.codigoAlmacen).toBe('ALM-002');
  });

  it('rejects a null codigoAlmacen instead of silently accepting it as absent', async () => {
    const instancia = plainToInstance(UpdateAlmacenDto, { codigoAlmacen: null });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });
});
