import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FakeModel } from '../../inventario/exitencia/fake-mongo-spec';
import { DENOMINACIONES_INICIALES } from './denominaciones-iniciales';
import { DenominacionMonedaService } from './denominacion-moneda.service';

const crear = (docs: Record<string, unknown>[] = []) => {
  const modelo = new FakeModel(docs, { unico: ['moneda', 'valor'] });
  const servicio = new DenominacionMonedaService(modelo as never);

  return { modelo, servicio };
};

describe('DenominacionMonedaService', () => {
  describe('denominaciones iniciales', () => {
    it('CUP hasta 5000; USD y EUR hasta 100', () => {
      const maximo = (moneda: string) =>
        Math.max(
          ...DENOMINACIONES_INICIALES.filter((d) => d.moneda === moneda).map(
            (d) => d.valor,
          ),
        );

      expect(maximo('CUP')).toBe(5000);
      expect(maximo('USD')).toBe(100);
      expect(maximo('EUR')).toBe(100);
    });
  });

  describe('sembrarSiVacia', () => {
    it('llena la colección la primera vez', async () => {
      const { modelo, servicio } = crear();

      const n = await servicio.sembrarSiVacia();

      expect(n).toBe(DENOMINACIONES_INICIALES.length);
      expect(modelo.docs).toHaveLength(DENOMINACIONES_INICIALES.length);
      expect(modelo.docs.every((d) => d.activa === true)).toBe(true);
    });

    it('no toca una colección que ya tiene datos (aunque el usuario haya quitado alguna)', async () => {
      const { modelo, servicio } = crear([
        { moneda: 'USD', valor: 100, tipo: 'billete', activa: true },
      ]);

      expect(await servicio.sembrarSiVacia()).toBe(0);
      expect(modelo.docs).toHaveLength(1);
    });

    it('al arrancar dos veces no duplica', async () => {
      const { modelo, servicio } = crear();

      await servicio.onApplicationBootstrap();
      await servicio.onApplicationBootstrap();

      expect(modelo.docs).toHaveLength(DENOMINACIONES_INICIALES.length);
    });

    it('un fallo al sembrar no impide arrancar', async () => {
      const { modelo, servicio } = crear();
      modelo.fallarSi = undefined;
      jest.spyOn(modelo, 'insertMany').mockRejectedValue(new Error('sin red'));
      const error = jest
        .spyOn(servicio['logger'], 'error')
        .mockImplementation(() => undefined);

      await expect(servicio.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('No se pudieron crear las denominaciones'),
      );
    });
  });

  describe('consultas', () => {
    const datos = [
      { moneda: 'USD', valor: 5, tipo: 'billete', activa: true },
      { moneda: 'USD', valor: 100, tipo: 'billete', activa: true },
      { moneda: 'USD', valor: 50, tipo: 'billete', activa: false },
      { moneda: 'EUR', valor: 20, tipo: 'billete', activa: true },
      { moneda: 'CUP', valor: 1000, tipo: 'billete', activa: true },
    ];

    it('listarActivas: solo las activas de la moneda, del mayor al menor (sin importar mayúsculas)', async () => {
      const { servicio } = crear(datos);

      expect(await servicio.listarActivas('usd')).toEqual([100, 5]);
      expect(await servicio.listarActivas(' EUR ')).toEqual([20]);
      expect(await servicio.listarActivas('MLC')).toEqual([]);
    });

    it('listarActivasPorMoneda: una sola consulta, agrupada', async () => {
      const { servicio } = crear(datos);

      const porMoneda = await servicio.listarActivasPorMoneda();

      expect([...porMoneda.keys()].sort()).toEqual(['CUP', 'EUR', 'USD']);
      expect(porMoneda.get('USD')).toEqual([100, 5]);
    });

    it('findAll ordena por moneda y del mayor al menor, y filtra por moneda', async () => {
      const { servicio } = crear(datos);

      const todas = await servicio.findAll();
      expect(todas.map((d) => `${d.moneda}-${d.valor}`)).toEqual([
        'CUP-1000',
        'EUR-20',
        'USD-100',
        'USD-50',
        'USD-5',
      ]);
      expect(await servicio.findAll('eur')).toHaveLength(1);
    });
  });

  describe('altas, cambios y bajas', () => {
    it('create guarda con los valores por defecto', async () => {
      const { servicio } = crear();

      const fila = await servicio.create({ moneda: 'USD', valor: 2 });

      expect(fila).toMatchObject({
        moneda: 'USD',
        valor: 2,
        tipo: 'billete',
        activa: true,
      });
    });

    it('una denominación repetida para la moneda → 409', async () => {
      const { servicio } = crear([
        { moneda: 'USD', valor: 100, tipo: 'billete', activa: true },
      ]);

      await expect(
        servicio.create({ moneda: 'USD', valor: 100 }),
      ).rejects.toThrow(ConflictException);
      await expect(
        servicio.create({ moneda: 'USD', valor: 100 }),
      ).rejects.toThrow(/Ya existe la denominación 100 de USD/);
    });

    it('update desactiva una denominación; remove la borra', async () => {
      const { modelo, servicio } = crear([
        { moneda: 'USD', valor: 100, tipo: 'billete', activa: true },
      ]);
      const id = String(modelo.docs[0]._id);

      const cambiada = await servicio.update(id, { activa: false });
      expect(cambiada.activa).toBe(false);
      expect(await servicio.listarActivas('USD')).toEqual([]);

      await servicio.remove(id);
      expect(modelo.docs).toHaveLength(0);
    });

    it('un id mal formado → 400; uno que no existe → 404', async () => {
      const { servicio } = crear();

      await expect(servicio.findOne('no-es-un-id')).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        servicio.findOne('64b7f0f0f0f0f0f0f0f0f0f0'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        servicio.update('64b7f0f0f0f0f0f0f0f0f0f0', { activa: false }),
      ).rejects.toThrow(NotFoundException);
      await expect(servicio.remove('64b7f0f0f0f0f0f0f0f0f0f0')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
