import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { Tasa, TasaDocument } from "./schemas/tasa.schema";
import { CreateTasaDto } from "./dto/create-tasa.dto";
import { UpdateTasaDto } from "./dto/update-tasa.dto";
import {
    Moneda,
    MonedaDocument,
} from "../nomencladores/moneda/schema/moneda.schema";

@Injectable()
export class TasaService {
    constructor(
        @InjectModel(Tasa.name)
        private readonly tasaModel: Model<TasaDocument>,

        @InjectModel(Moneda.name)
        private readonly monedaModel: Model<MonedaDocument>,
    ) {}

    private normalizarMoneda(moneda: string): string {
        const codigo = moneda?.trim().toUpperCase();

        if (!codigo) {
            throw new BadRequestException(
                "El código de moneda es obligatorio",
            );
        }

        return codigo;
    }

    private async validarMoneda(moneda: string): Promise<string> {
        const codigo = this.normalizarMoneda(moneda);

        const monedaValida = await this.monedaModel.exists({
            tipo_moneda: codigo,
        });

        if (!monedaValida) {
            throw new BadRequestException(
                `La moneda ${codigo} no existe en la colección moneda`,
            );
        }

        return codigo;
    }

    // Crear un registro histórico. Se permiten varias tasas por moneda.
    async create(createTasaDto: CreateTasaDto): Promise<Tasa> {
        const moneda = await this.validarMoneda(createTasaDto.moneda);

        return this.tasaModel.create({
            ...createTasaDto,
            moneda,
            fechaActualizacion: createTasaDto.fechaActualizacion
                ? new Date(createTasaDto.fechaActualizacion)
                : new Date(),
        });
    }

    // Devolver todo el historial, del más reciente al más antiguo.
    async findAll(): Promise<Tasa[]> {
        return this.tasaModel
            .find()
            .sort({
                fechaActualizacion: -1,
                createdAt: -1,
                _id: -1,
            })
            .exec();
    }

    // Devolver la última tasa registrada para una moneda.
    async findByMoneda(moneda: string): Promise<Tasa> {
        const codigo = this.normalizarMoneda(moneda);

        const tasa = await this.tasaModel
            .findOne({ moneda: codigo })
            .sort({
                fechaActualizacion: -1,
                createdAt: -1,
                _id: -1,
            })
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

    // Cada vez que se pulsa Actualizar, se crea un documento nuevo.
    async upsertByMoneda(
        moneda: string,
        dto: UpdateTasaDto,
    ): Promise<Tasa> {
        const codigo = await this.validarMoneda(moneda);

        return this.tasaModel.create({
            tasaBancoCentral: dto.tasaBancoCentral,
            tasaMercadoInformal: dto.tasaMercadoInformal,
            iva: dto.iva ?? 0,
            activa: dto.activa ?? true,
            moneda: codigo,
            fechaActualizacion: dto.fechaActualizacion
                ? new Date(dto.fechaActualizacion)
                : new Date(),
        });
    }

    // Este método modifica un registro específico por su ID.
    // El botón Actualizar de la pantalla debe utilizar upsertByMoneda.
    async update(
        id: string,
        updateTasaDto: UpdateTasaDto,
    ): Promise<Tasa> {
        const datos: Record<string, unknown> = {
            ...updateTasaDto,
        };

        if (updateTasaDto.moneda !== undefined) {
            datos.moneda = await this.validarMoneda(
                updateTasaDto.moneda,
            );
        }

        if (updateTasaDto.fechaActualizacion !== undefined) {
            datos.fechaActualizacion = new Date(
                updateTasaDto.fechaActualizacion,
            );
        }

        const tasa = await this.tasaModel
            .findByIdAndUpdate(
                id,
                { $set: datos },
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
        const tasa = await this.tasaModel
            .findByIdAndDelete(id)
            .exec();

        if (!tasa) {
            throw new NotFoundException("No se encontró la tasa");
        }
    }
}
