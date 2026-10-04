import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { Tasa, TasaDocument } from "./schemas/tasa.schema";
import { CreateTasaDto } from "./dto/create-tasa.dto";
import { UpdateTasaDto } from "./dto/update-tasa.dto";
import { NomencladoresService } from "../nomencladore generales/nomencladoresg.service";



@Injectable()
export class TasaService {
  constructor(
    @InjectModel(Tasa.name)
    private readonly tasaModel: Model<TasaDocument>,

    private readonly nomencladoresService: NomencladoresService,
  ) {}

  /**
   * Normaliza el código de moneda de forma consistente con los valores
   * del nomenclador, cuyos códigos se guardan en mayúsculas.
   */
  private normalizarMoneda(moneda: string): string {
    const codigo = moneda?.trim().toUpperCase();

    if (!codigo) {
      throw new BadRequestException(
        "El código de moneda es obligatorio",
      );
    }

    return codigo;
  }

  /**
   * Asegura que el código recibido pertenezca a un valor ACTIVO del
   * nomenclador MONEDA. listarValores('MONEDA') ya devuelve únicamente
   * activos porque incluirInactivos es false por defecto.
   */
  private async validarMoneda(moneda: string): Promise<string> {
    const codigo = this.normalizarMoneda(moneda);

    const monedas = await this.nomencladoresService.listarValores(
      "MONEDA",
    );

    const monedaValida = monedas.some(
      (valor) => valor.codigo === codigo,
    );

    if (!monedaValida) {
      throw new BadRequestException(
        `La moneda ${codigo} no existe o está inactiva en el nomenclador MONEDA`,
      );
    }

    return codigo;
  }

  async create(createTasaDto: CreateTasaDto): Promise<Tasa> {
    const moneda = await this.validarMoneda(createTasaDto.moneda);

    const existe = await this.tasaModel.exists({ moneda });

    if (existe) {
      throw new ConflictException(
        `Ya existe una tasa para la moneda ${moneda}`,
      );
    }

    try {
      return await this.tasaModel.create({
        ...createTasaDto,
        moneda,
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          `Ya existe una tasa para la moneda ${moneda}`,
        );
      }

      throw error;
    }
  }

  async findAll(): Promise<Tasa[]> {
    return this.tasaModel.find().sort({ moneda: 1 }).exec();
  }

  /**
   * No se valida contra el nomenclador aquí, porque una tasa histórica
   * puede existir aunque una moneda haya sido desactivada después.
   */
  async findByMoneda(moneda: string): Promise<Tasa> {
    const codigo = this.normalizarMoneda(moneda);

    const tasa = await this.tasaModel
      .findOne({ moneda: codigo })
      .exec();

    if (!tasa) {
      throw new NotFoundException(
        `No se encontró la tasa para la moneda ${codigo}`,
      );
    }

    return tasa;
  }

  async findOne(id: string): Promise<Tasa> {
    const tasa = await this.tasaModel.findById(id).exec();

    if (!tasa) {
      throw new NotFoundException("No se encontró la tasa");
    }

    return tasa;
  }

  async upsertByMoneda(
    moneda: string,
    dto: UpdateTasaDto,
  ): Promise<Tasa> {
    const codigo = await this.validarMoneda(moneda);

    const tasa = await this.tasaModel
      .findOneAndUpdate(
        { moneda: codigo },
        {
          $set: {
            ...dto,
            moneda: codigo,
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      )
      .exec();

    if (!tasa) {
      throw new NotFoundException(
        `No se pudo crear o actualizar la tasa para ${codigo}`,
      );
    }

    return tasa;
  }

  async update(
    id: string,
    updateTasaDto: UpdateTasaDto,
  ): Promise<Tasa> {
    const tasa = await this.tasaModel
      .findByIdAndUpdate(
        id,
        {
          $set: updateTasaDto,
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .exec();

    if (!tasa) {
      throw new NotFoundException("No se encontró la tasa");
    }

    return tasa;
  }

  async remove(id: string): Promise<void> {
    const tasa = await this.tasaModel.findByIdAndDelete(id).exec();

    if (!tasa) {
      throw new NotFoundException("No se encontró la tasa");
    }
  }
}