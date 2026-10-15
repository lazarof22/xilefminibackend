import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProveedorDto } from './create-proveedor.dto';

const base = {
  codigo: ' PRV-001 ',
  nombre: 'Distribuidora Caribe',
  cuentaBancaria: '9225 1234',
  direccion: 'Calle 23 #456',
  telefono: 53555000,
};

const errores = async (datos: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateProveedorDto, datos))).map(
    (e) => e.property,
  );

describe('CreateProveedorDto', () => {
  it('acepta datos válidos y recorta los espacios', async () => {
    const dto = plainToInstance(CreateProveedorDto, base);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.codigo).toBe('PRV-001');
  });

  it('acepta el teléfono como texto numérico', async () => {
    expect(await errores({ ...base, telefono: '53555000' })).toEqual([]);
  });

  it.each(['codigo', 'nombre', 'cuentaBancaria', 'direccion', 'telefono'])(
    'exige %s',
    async (campo) => {
      const resto: Record<string, unknown> = { ...base };
      delete resto[campo];
      expect(await errores(resto)).toContain(campo);
    },
  );

  it('rechaza teléfonos con letras, decimales o negativos', async () => {
    for (const telefono of ['abc', 5.5, -1, '53 555 000']) {
      expect(await errores({ ...base, telefono })).toContain('telefono');
    }
  });

  it('rechaza campos de texto en blanco', async () => {
    expect(await errores({ ...base, nombre: '   ' })).toContain('nombre');
  });
});
