import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUsuarioDto } from './create-usuario.dto';

function dtoValido(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ci_empleado: '12345678901',
    nombre_empleado: 'Juan Perez',
    correo_empleado: 'juan@xilef.com',
    contraseña: 'Password123!',
    departamento: 'Ventas',
    cargo: 'Vendedor',
    salario: 2500,
    ...overrides,
  };
}

async function erroresDeRol(rol: unknown): Promise<string[]> {
  const dto = plainToInstance(CreateUsuarioDto, dtoValido({ rol }));
  const errores = await validate(dto);
  return errores.map((e) => e.property);
}

describe('CreateUsuarioDto rol', () => {
  it.each(['administrador', 'gerente', 'economico', 'cajero', 'facturador'])(
    'accepts the spec role "%s"',
    async (rol) => {
      expect(await erroresDeRol(rol)).toEqual([]);
    },
  );

  it('rejects an unknown role', async () => {
    expect(await erroresDeRol('almacenero')).toEqual(['rol']);
  });
});
