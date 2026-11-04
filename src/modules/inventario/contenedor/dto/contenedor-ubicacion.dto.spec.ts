import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { model } from 'mongoose';
import { CreateContenedorDto } from './create-contenedor.dto';
import { UpdateContenedorDto } from './update-contenedor.dto';
import { ContenedorSchema } from '../schema/contenedor.schema';

const base = {
  nombreContenedor: 'Estante 1',
  codigoContenedor: 'E1',
  almacen: '64b7f0c2a1b2c3d4e5f60718',
};

describe('Contenedor: sección, estante y casilla (doc §6.1)', () => {
  describe('CreateContenedorDto', () => {
    it('sigue siendo válido sin la ubicación física', async () => {
      const dto = plainToInstance(CreateContenedorDto, base);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('acepta sección, estante y casilla', async () => {
      const dto = plainToInstance(CreateContenedorDto, {
        ...base,
        seccion: 'Secos',
        estante: 'B',
        casilla: '3',
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject({
        seccion: 'Secos',
        estante: 'B',
        casilla: '3',
      });
    });

    it.each(['seccion', 'estante', 'casilla'])(
      'rechaza %s que no sea texto',
      async (campo) => {
        const dto = plainToInstance(CreateContenedorDto, {
          ...base,
          [campo]: 12,
        });
        const errores = await validate(dto);
        expect(errores.some((e) => e.property === campo)).toBe(true);
      },
    );

    it.each(['seccion', 'estante', 'casilla'])(
      'rechaza %s de más de 50 caracteres',
      async (campo) => {
        const dto = plainToInstance(CreateContenedorDto, {
          ...base,
          [campo]: 'x'.repeat(51),
        });
        const errores = await validate(dto);
        expect(errores.some((e) => e.property === campo)).toBe(true);
      },
    );
  });

  describe('UpdateContenedorDto', () => {
    it('acepta actualizar solo la casilla', async () => {
      const dto = plainToInstance(UpdateContenedorDto, { casilla: '7' });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rechaza una sección que no sea texto', async () => {
      const dto = plainToInstance(UpdateContenedorDto, { seccion: 5 });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'seccion')).toBe(true);
    });
  });

  describe('esquema', () => {
    const ContenedorModel = model('ContenedorUbicacionSpec', ContenedorSchema);

    it('guarda sección, estante y casilla', () => {
      const doc = new ContenedorModel({
        codigoContenedor: 'E1',
        nombreContenedor: 'Estante 1',
        almacen: base.almacen,
        seccion: 'Secos',
        estante: 'B',
        casilla: '3',
      });
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.toObject()).toMatchObject({
        seccion: 'Secos',
        estante: 'B',
        casilla: '3',
      });
    });

    it('un contenedor sin ubicación física sigue siendo válido', () => {
      const doc = new ContenedorModel({
        codigoContenedor: 'E1',
        nombreContenedor: 'Estante 1',
        almacen: base.almacen,
      });
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.seccion).toBeUndefined();
    });
  });
});
