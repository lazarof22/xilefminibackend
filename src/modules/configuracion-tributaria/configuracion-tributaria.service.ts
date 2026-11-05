import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CLAVE_CONFIG_VENTAS,
  ConfiguracionTributaria,
} from './schema/configuracion-tributaria.schema';

@Injectable()
export class ConfiguracionTributariaService {
  constructor(
    @InjectModel(ConfiguracionTributaria.name)
    private readonly configModel: Model<ConfiguracionTributaria>,
  ) {}

  /**
   * Impuesto sobre ventas vigente, en %. Sin configurar es 0. Un valor
   * inválido en la base de datos NO se corrige en silencio: vender con un
   * impuesto equivocado es peor que detener la venta con un error claro.
   */
  async obtenerImpuestoVentas(): Promise<number> {
    const config = await this.configModel
      .findOne({ clave: CLAVE_CONFIG_VENTAS })
      .lean()
      .exec();

    if (!config) return 0;

    const porciento = Number(config.impuestoVentasPorciento);
    if (!Number.isFinite(porciento) || porciento < 0 || porciento > 100) {
      throw new InternalServerErrorException(
        'La configuración tributaria del impuesto sobre ventas no es válida (debe estar entre 0 y 100). Corríjala antes de vender.',
      );
    }

    return porciento;
  }
}
