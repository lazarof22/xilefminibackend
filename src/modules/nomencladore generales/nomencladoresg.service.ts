import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  Nomenclador,
  NomencladorDocument,
} from './schemas/nomenclador.schema';

import {
  NomencladorValor,
  NomencladorValorDocument,
} from './schemas/nomenclador_valor.schema';

import { CrearNomencladorDto } from './dto/crear_nomenclador.dto';
import { ActualizarNomencladorDto } from './dto/actualizar_nomenclador.dto';
import { CrearValorNomencladorDto } from './dto/crear_valor_nomenclador.dto';
import { ActualizarValorNomencladorDto } from './dto/actualizar_valor_nomenclador.dto';

@Injectable()
export class NomencladoresService {
  constructor(
    @InjectModel(Nomenclador.name)
    private readonly nomencladorModel: Model<NomencladorDocument>,

    @InjectModel(NomencladorValor.name)
    private readonly valorModel: Model<NomencladorValorDocument>,
  ) {}

  // ============================================================
  // NOMENCLADORES
  // ============================================================

  async listarNomencladores() {
    const nomencladores = await this.nomencladorModel
      .find()
      .sort({
        orden: 1,
        nombre: 1,
      })
      .lean();

    const resultados = await Promise.all(
      nomencladores.map(async (nomenclador) => {
        const cantidadValores = await this.valorModel.countDocuments({
          nomencladorId: nomenclador._id,
        });

        return {
          ...nomenclador,
          cantidadValores,
        };
      }),
    );

    return resultados;
  }

  async obtenerNomencladorPorId(id: string) {
    this.validarObjectId(id);

    const nomenclador = await this.nomencladorModel
      .findById(id)
      .lean();

    if (!nomenclador) {
      throw new NotFoundException(
        'El nomenclador no existe',
      );
    }

    const cantidadValores = await this.valorModel.countDocuments({
      nomencladorId: nomenclador._id,
    });

    return {
      ...nomenclador,
      cantidadValores,
    };
  }

  async obtenerNomencladorPorCodigo(codigo: string) {
    const nomenclador = await this.nomencladorModel
      .findOne({
        codigo: codigo.toUpperCase(),
      })
      .lean();

    if (!nomenclador) {
      throw new NotFoundException(
        'El nomenclador no existe',
      );
    }

    return nomenclador;
  }

  async crearNomenclador(dto: CrearNomencladorDto) {
    const codigo = dto.codigo.trim().toUpperCase();

    const existe = await this.nomencladorModel.exists({
      codigo,
    });

    if (existe) {
      throw new ConflictException(
        'Ya existe un nomenclador con ese código',
      );
    }

    try {
      return await this.nomencladorModel.create({
        ...dto,
        codigo,
        activo: dto.activo ?? true,
        orden: dto.orden ?? 0,
        esSistema: dto.esSistema ?? false,
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error as { code?: number }).code === 11000
      ) {
        throw new ConflictException(
          'Ya existe un nomenclador con ese código',
        );
      }

      throw error;
    }
  }

  async actualizarNomenclador(
    id: string,
    dto: ActualizarNomencladorDto,
  ) {
    this.validarObjectId(id);

    const datosActualizar = {
      ...dto,
    };

    if (datosActualizar.codigo) {
      datosActualizar.codigo = datosActualizar.codigo
        .trim()
        .toUpperCase();
    }

    const nomenclador = await this.nomencladorModel
      .findByIdAndUpdate(
        id,
        datosActualizar,
        {
          new: true,
          runValidators: true,
        },
      )
      .lean();

    if (!nomenclador) {
      throw new NotFoundException(
        'El nomenclador no existe',
      );
    }

    return nomenclador;
  }

  async cambiarEstadoNomenclador(
    id: string,
    activo: boolean,
  ) {
    this.validarObjectId(id);

    const nomenclador = await this.nomencladorModel
      .findByIdAndUpdate(
        id,
        { activo },
        {
          new: true,
          runValidators: true,
        },
      )
      .lean();

    if (!nomenclador) {
      throw new NotFoundException(
        'El nomenclador no existe',
      );
    }

    return nomenclador;
  }

  // ============================================================
  // VALORES DE LOS NOMENCLADORES
  // ============================================================

  async listarValores(
    codigoNomenclador: string,
    incluirInactivos = false,
  ) {
    const nomenclador = await this.obtenerNomencladorPorCodigo(
      codigoNomenclador,
    );

    const filtro: any = {
      nomencladorId: nomenclador._id,
    };

    if (!incluirInactivos) {
      filtro.activo = true;
    }

    return this.valorModel
      .find(filtro)
      .sort({
        orden: 1,
        nombre: 1,
      })
      .lean();
  }

  async obtenerValorPorId(id: string) {
    this.validarObjectId(id);

    const valor = await this.valorModel
      .findById(id)
      .populate('nomencladorId')
      .lean();

    if (!valor) {
      throw new NotFoundException(
        'El valor del nomenclador no existe',
      );
    }

    return valor;
  }

  async crearValor(
    codigoNomenclador: string,
    dto: CrearValorNomencladorDto,
  ) {
    const nomenclador = await this.obtenerNomencladorPorCodigo(
      codigoNomenclador,
    );

    if (!nomenclador.activo) {
      throw new BadRequestException(
        'No se pueden agregar valores a un nomenclador inactivo',
      );
    }

    const codigo = dto.codigo.trim().toUpperCase();

    const existe = await this.valorModel.exists({
      nomencladorId: nomenclador._id,
      codigo,
    });

    if (existe) {
      throw new ConflictException(
        'Ya existe un valor con ese código dentro del nomenclador',
      );
    }

    try {
      return await this.valorModel.create({
        ...dto,
        codigo,
        nomencladorId: nomenclador._id,
        activo: dto.activo ?? true,
        orden: dto.orden ?? 0,
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          'Ya existe un valor con ese código dentro del nomenclador',
        );
      }

      throw error;
    }
  }

  async actualizarValor(
    id: string,
    dto: ActualizarValorNomencladorDto,
  ) {
    this.validarObjectId(id);

    const datosActualizar = {
      ...dto,
    };

    if (datosActualizar.codigo) {
      datosActualizar.codigo = datosActualizar.codigo
        .trim()
        .toUpperCase();
    }

    const valor = await this.valorModel
      .findByIdAndUpdate(
        id,
        datosActualizar,
        {
          new: true,
          runValidators: true,
        },
      )
      .lean();

    if (!valor) {
      throw new NotFoundException(
        'El valor del nomenclador no existe',
      );
    }

    return valor;
  }

  async cambiarEstadoValor(
    id: string,
    activo: boolean,
  ) {
    this.validarObjectId(id);

    const valor = await this.valorModel
      .findByIdAndUpdate(
        id,
        { activo },
        {
          new: true,
          runValidators: true,
        },
      )
      .lean();

    if (!valor) {
      throw new NotFoundException(
        'El valor del nomenclador no existe',
      );
    }

    return valor;
  }

  async eliminarValor(id: string) {
    this.validarObjectId(id);

    const valor = await this.valorModel.findByIdAndDelete(id);

    if (!valor) {
      throw new NotFoundException(
        'El valor del nomenclador no existe',
      );
    }

    return {
      message: 'Valor eliminado correctamente',
    };
  }

  private validarObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(
        'El identificador proporcionado no es válido',
      );
    }
  }
}