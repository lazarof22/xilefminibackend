import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateConfiguracionPagosDto } from './dto/update-configuracion-pagos.dto';
import {
  CLAVE_CONFIG_PAGOS,
  ConfiguracionPagos,
  TIPO_TASA_POR_DEFECTO,
  TIPOS_TASA,
  type TipoTasa,
} from './schema/configuracion-pagos.schema';

@Injectable()
export class ConfiguracionPagosService {
  constructor(
    @InjectModel(ConfiguracionPagos.name)
    private readonly configModel: Model<ConfiguracionPagos>,
  ) {}

  /**
   * Tasa con la que se convierten las monedas al cobrar. Sin configurar es la
   * del mercado informal. Un valor inválido en la base NO se corrige en
   * silencio: cobrar con una tasa equivocada es peor que detener el cobro.
   */
  async obtenerTipoTasa(): Promise<TipoTasa> {
    const config = await this.configModel
      .findOne({ clave: CLAVE_CONFIG_PAGOS })
      .lean()
      .exec();

    if (!config) return TIPO_TASA_POR_DEFECTO;

    if (!TIPOS_TASA.includes(config.tipoTasa)) {
      throw new InternalServerErrorException(
        `La configuración de pagos no es válida: tipoTasa debe ser ${TIPOS_TASA.join(' o ')}. Corríjala antes de cobrar en otras monedas.`,
      );
    }

    return config.tipoTasa;
  }

  async obtener(): Promise<{ tipoTasa: TipoTasa }> {
    return { tipoTasa: await this.obtenerTipoTasa() };
  }

  async actualizar(
    dto: UpdateConfiguracionPagosDto,
    usuario: string,
  ): Promise<{ tipoTasa: TipoTasa }> {
    await this.configModel
      .findOneAndUpdate(
        { clave: CLAVE_CONFIG_PAGOS },
        { $set: { tipoTasa: dto.tipoTasa, actualizadoPor: usuario } },
        { upsert: true, returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();

    return { tipoTasa: dto.tipoTasa };
  }
}
