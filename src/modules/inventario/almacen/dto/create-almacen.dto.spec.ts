import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAlmacenDto } from './create-almacen.dto';

function dtoValido(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    nombreAlmacen: 'Almacén Central',
    codigo: 'ALM-001',
    ...overrides,
  };
}

describe('CreateAlmacenDto (T2)', () => {
  it('accepts a valid payload with codigo', async () => {
    const instancia = plainToInstance(CreateAlmacenDto, dtoValido());
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });

  it('requires codigo', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigo: undefined }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigo')).toBe(true);
  });

  it('rejects an empty codigo', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigo: '' }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigo')).toBe(true);
  });

  it('rejects a codigo longer than 20 characters', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigo: 'A'.repeat(21) }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigo')).toBe(true);
  });

  it('rejects a non-string codigo', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigo: 123 }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigo')).toBe(true);
  });

  it('rejects a whitespace-only codigo', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigo: '   ' }),
    );
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'codigo')).toBe(true);
  });

  it('trims surrounding whitespace from a valid codigo', async () => {
    const instancia = plainToInstance(
      CreateAlmacenDto,
      dtoValido({ codigo: '  ALM-001  ' }),
    );
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
    expect(instancia.codigo).toBe('ALM-001');
  });
});
