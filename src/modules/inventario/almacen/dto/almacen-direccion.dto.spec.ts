import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { model } from 'mongoose';
import { CreateAlmacenDto } from './create-almacen.dto';
import { UpdateAlmacenDto } from './update-almacen.dto';
import { AlmacenSchema } from '../schema/almacen.schema';

const base = { nombreAlmacen: 'Central', codigoAlmacen: 'CEN' };

describe('Almacén: dirección (doc §6.1)', () => {
  describe('CreateAlmacenDto', () => {
    it('sigue siendo válido sin dirección', async () => {
      const dto = plainToInstance(CreateAlmacenDto, base);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('acepta una dirección', async () => {
      const dto = plainToInstance(CreateAlmacenDto, {
        ...base,
        direccion: 'Calle 23 #456, Vedado',
      });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.direccion).toBe('Calle 23 #456, Vedado');
    });

    it('rechaza una dirección que no sea texto', async () => {
      const dto = plainToInstance(CreateAlmacenDto, { ...base, direccion: 5 });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'direccion')).toBe(true);
    });

    it('rechaza una dirección de más de 200 caracteres', async () => {
      const dto = plainToInstance(CreateAlmacenDto, {
        ...base,
        direccion: 'x'.repeat(201),
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'direccion')).toBe(true);
    });
  });

  describe('UpdateAlmacenDto', () => {
    it('acepta actualizar solo la dirección', async () => {
      const dto = plainToInstance(UpdateAlmacenDto, { direccion: 'Otra' });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('rechaza una dirección que no sea texto', async () => {
      const dto = plainToInstance(UpdateAlmacenDto, { direccion: 5 });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'direccion')).toBe(true);
    });
  });

  describe('esquema', () => {
    const AlmacenModel = model('AlmacenDireccionSpec', AlmacenSchema);

    it('guarda la dirección', () => {
      const doc = new AlmacenModel({ ...base, direccion: 'Calle 23' });
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.toObject().direccion).toBe('Calle 23');
    });

    it('un almacén sin dirección sigue siendo válido', () => {
      const doc = new AlmacenModel(base);
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.direccion).toBeUndefined();
    });
  });
});
