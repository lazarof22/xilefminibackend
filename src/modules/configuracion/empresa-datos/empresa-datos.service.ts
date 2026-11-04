import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EmpresaDatos,
  EmpresaDatosDocument,
} from './schemas/empresa-datos.schema';
import { UpdateEmpresaDatosDto } from './dto/update-empresa-datos.dto';
import { Ciudad } from '../../nomencladores/ciudad/schema/ciudad.schema';
import { CiudadService } from '../../nomencladores/ciudad/ciudad.service';
import { NomencladorHelper } from '../nomenclador-helper/nomenclador-helper.service';

@Injectable()
export class EmpresaDatosService {
  constructor(
    @InjectModel(EmpresaDatos.name)
    private readonly empresaModel: Model<EmpresaDatosDocument>,
    private readonly nomencladorHelper: NomencladorHelper,
    private readonly ciudadService: CiudadService,
  ) {}

  /**
   * Datos de la empresa. `ciudad` siempre sale como texto imprimible: el
   * nombre actual de la Ciudad referenciada, o el texto guardado si el
   * documento es antiguo o la ciudad ya no existe.
   */
  async obtener(): Promise<EmpresaDatosDocument | null> {
    const doc = (await this.empresaModel
      .findOne()
      .lean()
      .exec()) as unknown as EmpresaDatosDocument | null;
    if (!doc || !doc.ciudadId) return doc;
    try {
      const ciudad = await this.ciudadService.findOne(String(doc.ciudadId));
      return { ...doc, ciudad: ciudad.nombreCiudad } as EmpresaDatosDocument;
    } catch (error) {
      if (error instanceof NotFoundException) return doc;
      throw error;
    }
  }

  async guardar(dto: UpdateEmpresaDatosDto): Promise<EmpresaDatosDocument> {
    const data: Record<string, unknown> = { ...dto };
    if (dto.pais && !this.nomencladorHelper.isObjectId(dto.pais)) {
      data.pais = await this.nomencladorHelper.findOrCreatePais(dto.pais);
    }
    const existente = await this.empresaModel.findOne();
    if (dto.ciudadId !== undefined || dto.ciudad !== undefined) {
      const paisId = data.pais ?? existente?.pais;
      Object.assign(
        data,
        await this.resolverCiudad(dto, paisId ? String(paisId) : undefined),
      );
    }
    if (existente) {
      Object.assign(existente, data);
      return existente.save();
    }
    const created = await this.empresaModel.create(data);
    return created;
  }

  /**
   * Devuelve `ciudad` (texto imprimible) y `ciudadId` (referencia).
   * - `ciudadId`: debe existir en el nomenclador.
   * - texto libre (legacy): se reutiliza la ciudad del país con ese nombre o
   *   se crea; sin país no se puede crear una Ciudad, así que solo queda el texto.
   * - texto vacío: limpia ambas.
   */
  private async resolverCiudad(
    dto: UpdateEmpresaDatosDto,
    paisId: string | undefined,
  ): Promise<{ ciudad?: string; ciudadId?: Types.ObjectId | string }> {
    if (dto.ciudadId) {
      const ciudad = await this.ciudadService.findOne(dto.ciudadId);
      return { ciudad: ciudad.nombreCiudad, ciudadId: dto.ciudadId };
    }
    const texto = dto.ciudad?.trim();
    if (!texto) return { ciudad: '', ciudadId: undefined };
    if (!paisId) return { ciudad: texto, ciudadId: undefined };

    const clave = texto.toLowerCase();
    const delPais = await this.ciudadService.findAll(paisId);
    const existente = delPais.find(
      (c) => c.nombreCiudad.trim().toLowerCase() === clave,
    ) as (Ciudad & { _id: Types.ObjectId }) | undefined;
    const ciudad =
      existente ??
      ((await this.ciudadService.create({
        nombreCiudad: texto,
        pais: paisId,
      })) as Ciudad & { _id: Types.ObjectId });
    return { ciudad: ciudad.nombreCiudad, ciudadId: ciudad._id };
  }

  async guardarLogo(logo: string): Promise<EmpresaDatosDocument> {
    const existente = await this.empresaModel.findOne();
    if (existente) {
      existente.logo = logo;
      return existente.save();
    }
    const created = await this.empresaModel.create({ nombre: 'Sin nombre', logo });
    return created;
  }
}
