import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { FakeModel } from '../../inventario/exitencia/fake-mongo-spec';
import { BancoService } from './banco.service';
import { BANCOS_INICIALES } from './bancos-iniciales';

const crear = (docs: Record<string, unknown>[] = []) => {
  const modelo = new FakeModel(docs, { unico: ['codigo'] });
  const servicio = new BancoService(modelo as never);

  return { modelo, servicio };
};

const BANCOS = [
  {
    codigo: 'BPA',
    nombre: 'Banco Popular de Ahorro',
    prefijosTarjeta: ['????0699'],
    activo: true,
  },
  {
    codigo: 'BM',
    nombre: 'Banco Metropolitano',
    prefijosTarjeta: ['????0598'],
    activo: true,
  },
  {
    codigo: 'BANDEC',
    nombre: 'Banco de Crédito y Comercio',
    prefijosTarjeta: [],
    activo: true,
  },
  {
    codigo: 'VIEJO',
    nombre: 'Banco cerrado',
    prefijosTarjeta: ['9999'],
    activo: false,
  },
];

describe('BancoService', () => {
  describe('bancos iniciales', () => {
    it('son los que ya ofrecía el diálogo de transferencia', () => {
      expect(BANCOS_INICIALES.map((b) => b.codigo)).toEqual([
        'BPA',
        'BANDEC',
        'BM',
        'BICSA',
      ]);
    });

    it('se crean la primera vez, sin prefijos de tarjeta (no hay fuente oficial), una sola vez', async () => {
      const { modelo, servicio } = crear();

      expect(await servicio.sembrarSiVacio()).toBe(4);
      expect(await servicio.sembrarSiVacio()).toBe(0);
      expect(modelo.docs).toHaveLength(4);
      expect(
        modelo.docs.every((b) => (b.prefijosTarjeta as string[]).length === 0),
      ).toBe(true);
      expect(modelo.docs.every((b) => b.activo === true)).toBe(true);
    });
  });

  describe('resolver', () => {
    it('por id: devuelve el banco con sus prefijos', async () => {
      const { modelo, servicio } = crear(BANCOS);

      const banco = await servicio.resolver({
        bancoId: String(modelo.docs[0]._id),
      });

      expect(banco).toMatchObject({
        codigo: 'BPA',
        nombre: 'Banco Popular de Ahorro',
        prefijosTarjeta: ['????0699'],
      });
    });

    it('por id: un banco inexistente o desactivado se rechaza con código estable', async () => {
      const { modelo, servicio } = crear(BANCOS);

      for (const bancoId of [
        String(new Types.ObjectId()),
        String(modelo.docs[3]._id),
      ]) {
        const error = await servicio.resolver({ bancoId }).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(BadRequestException);
        expect(
          (error as BadRequestException).getResponse() as { codigo: string },
        ).toMatchObject({ codigo: 'BANCO_NO_VALIDO' });
      }
    });

    it('por código (texto libre del diálogo anterior): sin importar mayúsculas; si no existe, undefined', async () => {
      const { servicio } = crear(BANCOS);

      expect((await servicio.resolver({ codigo: ' bm ' }))?.codigo).toBe('BM');
      expect(await servicio.resolver({ codigo: 'XYZ' })).toBeUndefined();
      expect(await servicio.resolver({ codigo: 'VIEJO' })).toBeUndefined();
      expect(await servicio.resolver({})).toBeUndefined();
    });
  });

  describe('advertenciaDeTarjeta', () => {
    it('sin prefijos configurados no hay nada contra qué validar', async () => {
      const { modelo, servicio } = crear(BANCOS);
      const bandec = (await servicio.resolver({
        bancoId: String(modelo.docs[2]._id),
      }))!;

      expect(
        await servicio.advertenciaDeTarjeta(bandec, '1234 5678 9012 3456'),
      ).toBeUndefined();
    });

    it('coincide: sin aviso; de otro banco: lo nombra; de ninguno: aviso genérico', async () => {
      const { modelo, servicio } = crear(BANCOS);
      const bpa = (await servicio.resolver({
        bancoId: String(modelo.docs[0]._id),
      }))!;

      expect(
        await servicio.advertenciaDeTarjeta(bpa, '9225 0699 0000 1111'),
      ).toBeUndefined();
      expect(
        await servicio.advertenciaDeTarjeta(bpa, '9225 0598 0000 1111'),
      ).toMatch(
        /parece de Banco Metropolitano \(BM\), no de Banco Popular de Ahorro \(BPA\)/,
      );
      expect(
        await servicio.advertenciaDeTarjeta(bpa, '9225 1234 0000 1111'),
      ).toMatch(/no empieza con ninguno de los prefijos configurados/);
    });

    it('un banco desactivado no se usa para reconocer la tarjeta', async () => {
      const { modelo, servicio } = crear(BANCOS);
      const bpa = (await servicio.resolver({
        bancoId: String(modelo.docs[0]._id),
      }))!;

      expect(
        await servicio.advertenciaDeTarjeta(bpa, '9999 0000 1111 2222'),
      ).toMatch(/no empieza con ninguno/);
    });
  });

  describe('altas, cambios y bajas', () => {
    it('create y un código repetido → 409', async () => {
      const { servicio } = crear();

      const banco = await servicio.create({
        codigo: 'BFI',
        nombre: 'Banco Financiero Internacional',
        prefijosTarjeta: ['9210', '????0123'],
      });

      expect(banco).toMatchObject({
        codigo: 'BFI',
        prefijosTarjeta: ['9210', '????0123'],
        activo: true,
      });
      await expect(
        servicio.create({ codigo: 'BFI', nombre: 'Otro' }),
      ).rejects.toThrow(ConflictException);
    });

    it('update cambia los prefijos y puede desactivar; findAll(true) solo trae los activos', async () => {
      const { modelo, servicio } = crear(BANCOS);
      const id = String(modelo.docs[2]._id);

      const cambiado = await servicio.update(id, {
        prefijosTarjeta: ['????0695'],
      });
      expect(cambiado.prefijosTarjeta).toEqual(['????0695']);

      await servicio.update(id, { activo: false });
      expect((await servicio.findAll(true)).map((b) => b.codigo)).toEqual([
        'BM',
        'BPA',
      ]);
      expect(await servicio.findAll()).toHaveLength(4);
    });

    it('remove borra; un id que no existe → 404', async () => {
      const { modelo, servicio } = crear(BANCOS);

      await servicio.remove(String(modelo.docs[0]._id));
      expect(modelo.docs).toHaveLength(3);
      await expect(
        servicio.remove(String(new Types.ObjectId())),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
