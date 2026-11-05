import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { model, Types } from 'mongoose';
import { KardexSchema, KardexTipo } from './schema/kardex.schema';
import { CreateKardexDto } from './dto/create-kardex.dto';

const KardexModel = model('KardexContableSpec', KardexSchema);

const dtoBase = {
  productoId: new Types.ObjectId().toHexString(),
  tipo: KardexTipo.COMPRA,
  cantidad: 2,
  motivo: 'Recepción RE-000001',
};

const contables = {
  importeCUP: 1200,
  importeDivisa: 10,
  costoPromedio: 600,
  ubicacionFisica: 'Central / Estante 1 / A3',
  referenciaContable: 'SC-2-13-0001',
};

describe('Kardex extendido a Submayor SC-2-13 (doc §6.6)', () => {
  describe('esquema', () => {
    const entrada = (extra: Record<string, unknown> = {}) =>
      new KardexModel({
        productoId: new Types.ObjectId(),
        tipo: KardexTipo.COMPRA,
        cantidad: 2,
        stock: 5,
        motivo: 'Compra',
        ...extra,
      });

    it('guarda los campos contables', () => {
      const doc = entrada(contables);
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.toObject()).toMatchObject(contables);
    });

    it('un movimiento sin campos contables sigue siendo válido', () => {
      const doc = entrada();
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.importeCUP).toBeUndefined();
      expect(doc.costoPromedio).toBeUndefined();
    });

    it.each(['importeCUP', 'importeDivisa', 'costoPromedio'])(
      'rechaza %s negativo',
      (campo) => {
        const error = entrada({ [campo]: -1 }).validateSync();
        expect(error?.errors[campo]).toBeDefined();
      },
    );

    it('acepta importes en cero', () => {
      expect(
        entrada({ importeCUP: 0, importeDivisa: 0, costoPromedio: 0 })
          .validateSync(),
      ).toBeUndefined();
    });

    it('conserva los valores de KardexTipo existentes y añade AJUSTE', () => {
      expect(KardexTipo).toMatchObject({
        ENTRADA: 'entrada',
        SALIDA: 'salida',
        VENTA: 'venta',
        COMPRA: 'compra',
        TRANSFERENCIA_SALIDA: 'transferencia_salida',
        TRANSFERENCIA_ENTRADA: 'transferencia_entrada',
        DEVOLUCION: 'devolucion',
        AJUSTE: 'ajuste',
      });
      expect(entrada({ tipo: KardexTipo.AJUSTE }).validateSync()).toBeUndefined();
    });
  });

  describe('CreateKardexDto', () => {
    it('sigue siendo válido sin campos contables', async () => {
      const dto = plainToInstance(CreateKardexDto, dtoBase);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('acepta los campos contables que no calcula el servidor', async () => {
      const { importeDivisa, ubicacionFisica, referenciaContable } = contables;
      const enviados = { importeDivisa, ubicacionFisica, referenciaContable };
      const dto = plainToInstance(CreateKardexDto, { ...dtoBase, ...enviados });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject(enviados);
    });

    it.each(['importeCUP', 'costoPromedio'])(
      'no deja que el cliente fije %s (lo calcula el servidor)',
      async (campo) => {
        const errores = await validate(
          plainToInstance(CreateKardexDto, { ...dtoBase, [campo]: 5 }),
          { whitelist: true, forbidNonWhitelisted: true },
        );
        expect(errores.some((e) => e.property === campo)).toBe(true);
      },
    );

    it.each(['importeDivisa'])(
      'rechaza %s negativo',
      async (campo) => {
        const dto = plainToInstance(CreateKardexDto, {
          ...dtoBase,
          [campo]: -5,
        });
        const errores = await validate(dto);
        expect(errores.some((e) => e.property === campo)).toBe(true);
      },
    );

    it.each(['importeDivisa'])(
      'rechaza %s que no sea número',
      async (campo) => {
        const dto = plainToInstance(CreateKardexDto, {
          ...dtoBase,
          [campo]: 'mucho',
        });
        const errores = await validate(dto);
        expect(errores.some((e) => e.property === campo)).toBe(true);
      },
    );

    it.each(['ubicacionFisica', 'referenciaContable'])(
      'rechaza %s que no sea texto',
      async (campo) => {
        const dto = plainToInstance(CreateKardexDto, {
          ...dtoBase,
          [campo]: 7,
        });
        const errores = await validate(dto);
        expect(errores.some((e) => e.property === campo)).toBe(true);
      },
    );
  });
});
