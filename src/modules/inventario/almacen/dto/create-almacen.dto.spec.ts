import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAlmacenDto } from './create-almacen.dto';

function dtoValido(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    nombreAlmacen: 'Almacén Central',
    codigoAlmacen: 'ALM-001',
    ...overrides,
  };
}

describe('CreateAlmacenDto (T2)', () => {
  it('accepts a valid payload with codigoAlmacen', async () => {
    const instancia = plainToInstance(CreateAlmacenDto, dtoValido());
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('requires codigoAlmacen', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigoAlmacen: undefined }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('rejects an empty codigoAlmacen', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigoAlmacen: '' }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('rejects a codigoAlmacen longer than 20 characters', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigoAlmacen: 'A'.repeat(21) }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('rejects a non-string codigoAlmacen', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigoAlmacen: 123 }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('rejects a whitespace-only codigoAlmacen', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigoAlmacen: '   ' }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigoAlmacen')).toBe(true);
  });

  it('trims surrounding whitespace from a valid codigoAlmacen', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigoAlmacen: '  ALM-001  ' }),
    );
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
    expect(instancia.codigoAlmacen).toBe('ALM-001');
  });
});
