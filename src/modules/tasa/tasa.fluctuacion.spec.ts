import 'reflect-metadata';
import { model } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTasaDto } from './dto/create-tasa.dto';
import { UpdateTasaDto } from './dto/update-tasa.dto';
import { TasaSchema } from './schemas/tasa.schema';
import { TasaService } from './tasa.service';

const base = { moneda: 'USD', tasaBancoCentral: 120, tasaMercadoInformal: 400 };

describe('Tasa.fluctuacion', () => {
  const TasaModel = model('TasaFluctuacionSpec', TasaSchema);

  it('vale 0 por omisión', () => {
    expect(new TasaModel(base).fluctuacion).toBe(0);
  });

  it('persiste la variación indicada, también negativa', () => {
    expect(new TasaModel({ ...base, fluctuacion: -2.5 }).fluctuacion).toBe(-2.5);
  });

  it('el DTO de creación y el de actualización la aceptan', async () => {
    expect(
      await validate(plainToInstance(CreateTasaDto, { ...base, fluctuacion: 3 })),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(UpdateTasaDto, { fluctuacion: -1 })),
    ).toHaveLength(0);
  });

  it('el DTO rechaza un valor no numérico', async () => {
    const e = await validate(
      plainToInstance(CreateTasaDto, { ...base, fluctuacion: 'mucho' }),
    );
    expect(e.map((x) => x.property)).toContain('fluctuacion');
  });

  describe('TasaService.upsertByMoneda', () => {
    const crear = () => {
      const tasaModel = { create: jest.fn((d: object) => Promise.resolve(d)) };
      const monedaModel = { exists: jest.fn().mockResolvedValue({ _id: 'm' }) };
      const service = new TasaService(tasaModel as never, monedaModel as never);
      return { service, tasaModel };
    };

    it('persiste la fluctuación enviada', async () => {
      const { service, tasaModel } = crear();
      await service.upsertByMoneda('usd', { ...base, fluctuacion: 4.2 });
      expect(tasaModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ moneda: 'USD', fluctuacion: 4.2 }),
      );
    });

    it('sin fluctuación guarda 0', async () => {
      const { service, tasaModel } = crear();
      await service.upsertByMoneda('usd', base);
      expect(tasaModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ fluctuacion: 0 }),
      );
    });
  });
});
