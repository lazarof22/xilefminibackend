import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Producto,
  ProductoDocument,
} from '../../inventario/producto/schemas/producto.schema';
import {
  Cuenta,
  CuentaDocument,
  GrupoCuenta,
  NaturalezaCuenta,
} from '../../contabilidad/cuenta/schema/cuenta.schema';
import { NomencladorHelper } from '../nomenclador-helper/nomenclador-helper.service';

interface CsvRow {
  codigo: string;
  nombre: string;
  precio_compra: string;
  precio_venta: string;
  stock_inicial: string;
  stock_minimo: string;
  categoria?: string;
  estado?: string;
}

interface CuentaCsvRow {
  codigo: string;
  nombre: string;
  naturaleza: string;
  moneda: string;
  denominacion?: string;
  grupo?: string;
  padre?: string;
  descripcion?: string;
  partida?: string;
  elemento?: string;
}

interface ImportResult {
  imported: number;
  errors: string[];
}

@Injectable()
export class ImportExportService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Producto.name)
    private readonly productoModel: Model<ProductoDocument>,
    @InjectModel(Cuenta.name)
    private readonly cuentaModel: Model<CuentaDocument>,
    private readonly nomencladorHelper: NomencladorHelper,
  ) {}

  private parseCsv(csv: string): CsvRow[] {
    const lines = csv
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException('CSV vacío o sin datos');
    }
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const required = [
      'codigo',
      'nombre',
      'precio_compra',
      'precio_venta',
      'stock_inicial',
      'stock_minimo',
    ];
    for (const r of required) {
      if (!headers.includes(r)) {
        throw new BadRequestException(
          `Falta columna requerida: ${r}. Columnas: ${headers.join(', ')}`,
        );
      }
    }
    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      if (values.length < headers.length) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });
      rows.push(row as unknown as CsvRow);
    }
    return rows;
  }

  async importProductsFromCsv(csv: string): Promise<ImportResult> {
    const rows = this.parseCsv(csv);
    let imported = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        if (!row.codigo || !row.nombre) {
          errors.push(`Fila inválida: código o nombre vacío`);
          continue;
        }
        const precioCompra = parseFloat(row.precio_compra);
        const precioVenta = parseFloat(row.precio_venta);
        const stockInicial = parseInt(row.stock_inicial, 10);
        const stockMinimo = parseInt(row.stock_minimo, 10);

        if (isNaN(precioCompra) || isNaN(precioVenta)) {
          errors.push(`Precios inválidos en: ${row.codigo}`);
          continue;
        }

        let categoriaId;
        if (row.categoria) {
          categoriaId = await this.nomencladorHelper.findOrCreateCategoria(row.categoria);
        }

        let estadoId;
        if (row.estado) {
          estadoId = await this.nomencladorHelper.findOrCreateEstado(row.estado);
        }

        const existing = await this.productoModel.findOne({
          codigo_producto: row.codigo,
        });
        if (existing) {
          existing.nombre_producto = row.nombre;
          existing.precio_compra = precioCompra;
          existing.precio_venta = precioVenta;
          existing.stock_inicial = stockInicial;
          existing.stock_minimo = stockMinimo;
          if (categoriaId) existing.categoria_producto = categoriaId;
          if (estadoId) existing.estado = estadoId;
          await existing.save();
        } else {
          await this.productoModel.create({
            codigo_producto: row.codigo,
            nombre_producto: row.nombre,
            precio_compra: precioCompra,
            precio_venta: precioVenta,
            stock_inicial: stockInicial,
            stock_minimo: stockMinimo,
            categoria_producto: categoriaId,
            estado: estadoId,
          });
        }
        imported++;
      } catch (err) {
        errors.push(`${row.codigo}: ${(err as Error).message}`);
      }
    }
    return { imported, errors };
  }

  /**
   * Importa cuentas contables desde CSV.
   * Columnas requeridas: codigo, nombre, naturaleza, moneda
   * Columnas opcionales: denominacion, grupo, padre, descripcion, partida, elemento
   *
   * - `naturaleza` se busca/crea en el nomenclador NaturalezaCuenta.
   * - `moneda` debe ser un ObjectId válido (no hay wrapper `findOrCreateMoneda`
   *   en NomencladorHelper; se valida formato pero no se auto-crea).
   * - Si el código ya existe, la fila se rechaza (no se hace upsert).
   */
  async importCuentasFromCsv(
    csv: string,
  ): Promise<ImportResult> {
    const lines = csv
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException('CSV vacío o sin datos');
    }
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const required = ['codigo', 'nombre', 'naturaleza', 'moneda'];
    for (const r of required) {
      if (!headers.includes(r)) {
        throw new BadRequestException(
          `Falta columna requerida: ${r}. Columnas: ${headers.join(', ')}`,
        );
      }
    }

    const rows: CuentaCsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map((v) => v.trim());
      if (values.length < headers.length) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });
      rows.push(row as unknown as CuentaCsvRow);
    }

    let imported = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        if (!row.codigo || !row.nombre) {
          errors.push(`Fila inválida: código o nombre vacío`);
          continue;
        }

        if (!Types.ObjectId.isValid(row.moneda)) {
          errors.push(`Moneda inválida en: ${row.codigo}`);
          continue;
        }

        if (
          await this.cuentaModel.findOne({ codigo: row.codigo }).exec()
        ) {
          errors.push(`Código duplicado: ${row.codigo}`);
          continue;
        }

        const naturalezaValores = Object.values(NaturalezaCuenta) as string[];
        if (!naturalezaValores.includes(row.naturaleza)) {
          errors.push(
            `Naturaleza inválida en: ${row.codigo} (debe ser ${naturalezaValores.join(' | ')})`,
          );
          continue;
        }

        let grupoEnum: GrupoCuenta | undefined;
        if (row.grupo) {
          const grupoValores = Object.values(GrupoCuenta) as string[];
          if (!grupoValores.includes(row.grupo)) {
            errors.push(
              `Grupo inválido en: ${row.codigo} (debe ser ${grupoValores.join(' | ')})`,
            );
            continue;
          }
          grupoEnum = row.grupo as GrupoCuenta;
        }

        let padreId: Types.ObjectId | null = null;
        if (row.padre) {
          if (!Types.ObjectId.isValid(row.padre)) {
            errors.push(`Padre inválido en: ${row.codigo}`);
            continue;
          }
          const padreExiste = await this.cuentaModel.findById(row.padre).exec();
          if (!padreExiste) {
            errors.push(`Padre inexistente en: ${row.codigo}`);
            continue;
          }
          padreId = new Types.ObjectId(row.padre);
        }

        const naturalezaId = await this.nomencladorHelper.findOrCreateNaturalezaCuenta(
          row.naturaleza,
        );

        const nivelPadre = padreId
          ? ((await this.cuentaModel.findById(padreId).exec())?.nivel ?? 0)
          : 0;
        const nivel =
          padreId
            ? nivelPadre + 1
            : row.codigo.split('.').filter(Boolean).length || 1;

        await this.cuentaModel.create({
          codigo: row.codigo,
          nombre: row.nombre,
          denominacion: row.denominacion ?? row.nombre,
          naturaleza: row.naturaleza as NaturalezaCuenta,
          moneda: new Types.ObjectId(row.moneda),
          padre: padreId,
          nivel,
          grupo: grupoEnum,
          partida: row.partida || undefined,
          elemento: row.elemento || undefined,
          descripcion: row.descripcion || undefined,
        });
        // `naturalezaId` queda calculado pero no se persiste: el campo
        // Cuenta.naturaleza es un enum fijo ('Deudora' | 'Acreedora'),
        // no una referencia. El nomenclador NaturalezaCuenta se mantiene
        // como catálogo auxiliar.
        void naturalezaId;
        imported++;
      } catch (err) {
        errors.push(`${row.codigo}: ${(err as Error).message}`);
      }
    }
    return { imported, errors };
  }

  async exportAllToJson(): Promise<Record<string, unknown[]>> {
    const collections = await this.connection.db!.listCollections().toArray();
    const result: Record<string, unknown[]> = {};

    const excludeCollections = new Set([
      'system.views', 'system.users', 'system.keys',
      'system.buckets', 'system.profile', 'system.js',
    ]);

    for (const col of collections) {
      const name = col.name;
      if (name.startsWith('system.') || excludeCollections.has(name)) continue;
      const docs = await this.connection.db!.collection(name).find().toArray();
      result[name] = docs.map((doc) => {
        const { _id, __v, ...rest } = doc as Record<string, unknown>;
        return rest;
      });
    }
    return result;
  }

  async importFromJson(
    data: Record<string, unknown[]>,
  ): Promise<ImportResult> {
    const errors: string[] = [];
    let imported = 0;

    for (const [collectionName, docs] of Object.entries(data)) {
      if (!Array.isArray(docs)) continue;
      try {
        const collection = this.connection.db!.collection(collectionName);
        for (const doc of docs) {
          try {
            await collection.insertOne(doc as Record<string, unknown>);
            imported++;
          } catch (err) {
            errors.push(`${collectionName}: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        errors.push(`${collectionName}: ${(err as Error).message}`);
      }
    }
    return { imported, errors };
  }
}