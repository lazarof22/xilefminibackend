import 'reflect-metadata';
import { model } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ProductoSchema } from './schemas/producto.schema';

const base = {
  codigo_producto: 'ARR-1',
  nombre_producto: 'Arroz',
  categoria_producto: 'Granos',
  precio_compra: 1,
  precio_venta: 2,
  stock_inicial: 3,
  stock_minimo: 1,
  estado: 'activo',
};

const errores = async <T extends object>(cls: new () => T, plano: object) =>
  validate(plainToInstance(cls, plano));

describe('Producto.gravado (doc §6.7)', () => {
  const ProductoModel = model('ProductoGravadoSpec', ProductoSchema);

  it('es "gravado" por omisión (compatible con productos existentes)', () => {
    expect(new ProductoModel(base).gravado).toBe('gravado');
  });

  it('persiste "exento" cuando se indica', () => {
    expect(new ProductoModel({ ...base, gravado: 'exento' }).gravado).toBe(
      'exento',
    );
  });

  it('el esquema rechaza valores fuera de gravado/exento', () => {
    const doc = new ProductoModel({ ...base, gravado: 'otro' });
    expect(doc.validateSync()?.errors.gravado).toBeDefined();
  });

  it('el DTO de creación acepta gravado y exento y es opcional', async () => {
    expect(await errores(CreateProductoDto, base)).toHaveLength(0);
    expect(
      await errores(CreateProductoDto, { ...base, gravado: 'exento' }),
    ).toHaveLength(0);
    expect(
      await errores(CreateProductoDto, { ...base, gravado: 'gravado' }),
    ).toHaveLength(0);
  });

  it('el DTO de creación rechaza un valor inválido', async () => {
    const e = await errores(CreateProductoDto, { ...base, gravado: 'libre' });
    expect(e.map((x) => x.property)).toContain('gravado');
  });

  it('el DTO de actualización valida igual', async () => {
    expect(
      await errores(UpdateProductoDto, { gravado: 'exento' }),
    ).toHaveLength(0);
    const e = await errores(UpdateProductoDto, { gravado: 'libre' });
    expect(e.map((x) => x.property)).toContain('gravado');
  });
});
