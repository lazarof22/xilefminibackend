import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ConfiguracionTributaria,
  ConfiguracionTributariaDocument,
} from './schemas/configuracion-tributaria.schema';
import { GuardarConfiguracionTributariaDto } from './dto/guardar-configuracion-tributaria.dto';

const esPorcentajeValido = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor <= 100;

@Injectable()
export class ConfiguracionTributariaService {
  constructor(
    @InjectModel(ConfiguracionTributaria.name)
    private readonly model: Model<ConfiguracionTributariaDocument>,
  ) {}

  /**
   * Configuración vigente, o `null` si nunca se configuró. No se inventa un
   * impuesto por defecto: la UI muestra "sin configurar".
   */
  async obtenerActiva(): Promise<ConfiguracionTributariaDocument | null> {
    return this.model
      .findOne({ activa: true })
      .sort({ vigenteDesde: -1, createdAt: -1 })
      .lean()
      .exec() as unknown as ConfiguracionTributariaDocument | null;
  }

  /** Todas las configuraciones (auditoría), la más reciente primero. */
  async historial(): Promise<ConfiguracionTributariaDocument[]> {
    return this.model
      .find()
      .sort({ vigenteDesde: -1, createdAt: -1 })
      .lean()
      .exec() as unknown as ConfiguracionTributariaDocument[];
  }

  /**
   * Crea una configuración nueva y desactiva las anteriores. Se crea primero
   * para no dejar el sistema sin configuración activa si la creación falla.
   */
  async guardar(
    dto: GuardarConfiguracionTributariaDto,
  ): Promise<ConfiguracionTributariaDocument> {
    if (!esPorcentajeValido(dto.impuestoVentasPct)) {
      throw new BadRequestException(
        'El impuesto sobre ventas debe estar entre 0 y 100',
      );
    }
    const bonificaciones = (dto.bonificaciones ?? []).map((b) => {
      if (!esPorcentajeValido(b.impuestoVentasPct)) {
        throw new BadRequestException(
          `La bonificación "${b.programa}" debe estar entre 0 y 100`,
        );
      }
      return {
        programa: b.programa,
        sector: b.sector,
        impuestoVentasPct: b.impuestoVentasPct,
        activa: b.activa ?? true,
      };
    });
    const vigenteDesde = dto.vigenteDesde
      ? new Date(dto.vigenteDesde)
      : new Date();
    if (Number.isNaN(vigenteDesde.getTime())) {
      throw new BadRequestException('La fecha de vigencia no es válida');
    }

    const creada = await this.model.create({
      impuestoVentasPct: dto.impuestoVentasPct,
      vigenteDesde,
      activa: true,
      bonificaciones,
    });
    await this.model
      .updateMany({ activa: true, _id: { $ne: creada._id } }, { $set: { activa: false } })
      .exec();
    return creada;
  }
}
