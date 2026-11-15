import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfiguracionPagosService } from '../../configuracion-pagos/configuracion-pagos.service';
import type { TipoTasa } from '../../configuracion-pagos/schema/configuracion-pagos.schema';
import { DenominacionMonedaService } from '../../nomencladores/denominacion-moneda/denominacion-moneda.service';
import { Moneda } from '../../nomencladores/moneda/schema/moneda.schema';
import { TasaService } from '../../tasa/tasa.service';
import { aCodigoMoneda, MONEDA_BASE, TASA_MONEDA_BASE } from './divisas';

/** Cuántos CUP vale 1 unidad de una moneda, con la tasa elegida. */
export interface TasaDeMoneda {
  codigo: string;
  cupPorUnidad: number;
  /** Fecha de la tasa registrada (no existe para el CUP). */
  fecha?: Date;
}

/** Una moneda con la que se puede cobrar ahora mismo. */
export interface MonedaCobro {
  codigo: string;
  nombre: string;
  cupPorUnidad: number;
  /** Billetes y monedas activos, del mayor al menor. */
  denominaciones: number[];
}

const ORDEN_MONEDAS = ['CUP', 'USD', 'EUR'];

const error = (mensaje: string, codigo: string): BadRequestException =>
  new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: mensaje,
    codigo,
  });

/**
 * Monedas y tasas del cobro. Las tasas son CUP por 1 unidad de cada moneda
 * (la del CUP es 1) y salen de la colección `tasas`, la que mantiene la
 * pantalla de Tasas; cuál de las dos se usa (Banco Central o mercado informal)
 * lo decide la configuración de pagos.
 */
@Injectable()
export class MonedaPagoService {
  constructor(
    private readonly tasas: TasaService,
    @InjectModel(Moneda.name) private readonly monedaModel: Model<Moneda>,
    private readonly denominaciones: DenominacionMonedaService,
    private readonly configuracion: ConfiguracionPagosService,
  ) {}

  tipoTasa(): Promise<TipoTasa> {
    return this.configuracion.obtenerTipoTasa();
  }

  /** Billetes y monedas activos de una moneda, del mayor al menor. */
  denominacionesDe(codigo: string): Promise<number[]> {
    return this.denominaciones.listarActivas(codigo);
  }

  /**
   * Cuántos CUP vale 1 unidad de `codigo` con la tasa `tipo`. Si no hay tasa,
   * está inactiva o no es válida, el cobro en esa moneda se rechaza: cobrar con
   * una tasa inventada o vieja desajusta la caja.
   */
  async tasaDe(codigo: string, tipo: TipoTasa): Promise<TasaDeMoneda> {
    if (codigo === MONEDA_BASE) {
      return { codigo, cupPorUnidad: TASA_MONEDA_BASE };
    }

    let tasa: Awaited<ReturnType<TasaService['findByMoneda']>>;
    try {
      tasa = await this.tasas.findByMoneda(codigo);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw error(
          `No hay una tasa registrada para ${codigo}: regístrela en Tasas antes de cobrar en esa moneda`,
          'TASA_NO_DISPONIBLE',
        );
      }
      throw e;
    }

    if (tasa.activa === false) {
      throw error(
        `La última tasa de ${codigo} está desactivada: registre una tasa vigente antes de cobrar en esa moneda`,
        'TASA_NO_DISPONIBLE',
      );
    }

    const valor = Number(tasa[tipo]);
    if (!Number.isFinite(valor) || valor <= 0) {
      throw error(
        `La tasa ${tipo} de ${codigo} no es válida (debe ser mayor que 0)`,
        'TASA_NO_VALIDA',
      );
    }

    return { codigo, cupPorUnidad: valor, fecha: tasa.fechaActualizacion };
  }

  /**
   * Monedas con las que se puede cobrar efectivo ahora mismo: el CUP siempre, y
   * cada moneda del nomenclador que tenga una tasa vigente y billetes
   * configurados. Una moneda sin tasa o sin denominaciones se omite (no es un
   * error: simplemente todavía no se puede cobrar en ella).
   */
  async monedasDeCobro(): Promise<{
    tipoTasa: TipoTasa;
    monedas: MonedaCobro[];
  }> {
    const tipoTasa = await this.tipoTasa();
    const registradas = await this.monedaModel.find().lean().exec();
    const nombres = new Map<string, string>();

    for (const moneda of registradas) {
      const codigo = aCodigoMoneda(moneda.tipo_moneda);
      if (codigo) nombres.set(codigo, moneda.nombre_moneda);
    }

    const denominaciones = await this.denominaciones.listarActivasPorMoneda();
    // Primero CUP, USD y EUR (las que usa el cajero a diario); luego el resto.
    const orden = (codigo: string): number => {
      const i = ORDEN_MONEDAS.indexOf(codigo);
      return i === -1 ? ORDEN_MONEDAS.length : i;
    };
    const codigos = [
      MONEDA_BASE,
      ...[...nombres.keys()]
        .filter((c) => c !== MONEDA_BASE)
        .sort((a, b) => orden(a) - orden(b) || a.localeCompare(b)),
    ];
    const monedas: MonedaCobro[] = [];

    for (const codigo of codigos) {
      const billetes = denominaciones.get(codigo) ?? [];
      if (billetes.length === 0) continue;

      try {
        const { cupPorUnidad } = await this.tasaDe(codigo, tipoTasa);
        monedas.push({
          codigo,
          nombre: nombres.get(codigo) ?? 'Peso cubano',
          cupPorUnidad,
          denominaciones: billetes,
        });
      } catch (e) {
        if (!(e instanceof BadRequestException)) throw e;
      }
    }

    return { tipoTasa, monedas };
  }
}
