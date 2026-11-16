import 'reflect-metadata';
import { model } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTasaDto } from './dto/create-tasa.dto';
import { UpdateTasaDto } from './dto/update-tasa.dto';
import { TasaSchema } from './schemas/tasa.schema';
import { TasaService } from './tasa.service';

const base = { moneda: 'USD', tasaBancoCentral: 120, tasaMercadoInformal: 400 };

/** §6.7: a tax is not an exchange rate, so `Tasa` carries no `iva`. */
describe('Tasa without tax (§6.7)', () => {
  it('the schema has no iva path', () => {
    expect(TasaSchema.path('iva')).toBeUndefined();
  });

  it('a created document does not carry iva', () => {
    const TasaModel = model('TasaSinIvaSpec', TasaSchema);
    const doc = new TasaModel({ ...base, iva: 10 });
    expect(doc.toObject()).not.toHaveProperty('iva');
  });

  it('the DTOs declare no iva property', () => {
    const create = plainToInstance(CreateTasaDto, { ...base, iva: 10 });
    const update = plainToInstance(UpdateTasaDto, { iva: 10 });
    for (const dto of [create, update]) {
      const validators = Reflect.getMetadata('design:type', dto, 'iva');
      expect(validators).toBeUndefined();
    }
  });

  it('the validator rejects an iva field when whitelisting is on (as the global pipe does)', async () => {
    const errores = await validate(
      plainToInstance(CreateTasaDto, { ...base, iva: 10 }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errores.map((e) => e.property)).toEqual(['iva']);
  });

  it('upsertByMoneda does not persist iva', async () => {
    const tasaModel = {
      create: jest.fn((d: object) => Promise.resolve(d)),
      findOne: jest.fn(() => ({
        sort: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
      })),
    };
    const monedaModel = { exists: jest.fn().mockResolvedValue({ _id: 'm' }) };
    const service = new TasaService(tasaModel as never, monedaModel as never);

    await service.upsertByMoneda('usd', { ...base, iva: 10 } as never);

    expect(tasaModel.create).toHaveBeenCalledTimes(1);
    expect(tasaModel.create.mock.calls[0][0]).not.toHaveProperty('iva');
  });
});
