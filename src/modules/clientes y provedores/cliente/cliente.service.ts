import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Cliente } from './schemas/cliente.schema';
import { Model } from 'mongoose';
import {
  PATRON_CI,
  PATRON_NIT,
  type TipoIdentidad,
} from '../../../common/utils/identidad';

@Injectable()
export class ClienteService {

  constructor(@InjectModel(Cliente.name)private clienteModel:Model<Cliente>){
    
  }


  /**
   * Comprueba la identidad del cliente según con qué se identifica: la CI
   * lleva exactamente 11 dígitos; el NIT, de 5 a 20 letras, números o guiones.
   * Devuelve lo que se guarda: en un cliente con NIT, `id_cliente` es el NIT
   * (el documento que lo identifica) salvo que se indique otro.
   */
  private validarIdentidad(
    tipo: TipoIdentidad,
    idCliente?: string,
    nit?: string,
  ): { id_cliente: string; nit?: string } {
    if (tipo === 'CI') {
      const ci = idCliente?.trim();

      if (!ci) {
        throw new BadRequestException('La CI del cliente es obligatoria');
      }
      if (!PATRON_CI.test(ci)) {
        throw new BadRequestException(
          'La CI debe tener exactamente 11 dígitos numéricos',
        );
      }

      return { id_cliente: ci };
    }

    const numero = nit?.trim();

    if (!numero) {
      throw new BadRequestException('El NIT del cliente es obligatorio');
    }
    if (!PATRON_NIT.test(numero)) {
      throw new BadRequestException(
        'El NIT debe tener de 5 a 20 letras, números o guiones',
      );
    }

    return { id_cliente: idCliente?.trim() || numero, nit: numero };
  }

  //Crear un cliente
  async create(createClienteDto: CreateClienteDto): Promise<Cliente> {
    const tipoIdentidad = createClienteDto.tipoIdentidad ?? 'CI';
    const identidad = this.validarIdentidad(
      tipoIdentidad,
      createClienteDto.id_cliente,
      createClienteDto.nit,
    );
    const datos = {
        ...createClienteDto,
        ...identidad,
        tipoIdentidad,
    };

    // Validar id_cliente
    const existClienteById = await this.clienteModel.findOne({
        id_cliente: datos.id_cliente,
    });
    if (existClienteById) {
        throw new BadRequestException('Ya existe un cliente con ese ID');
    }

    // Validar teléfono
    const existClienteByTelefono = await this.clienteModel.findOne({
        telefono_cliente: createClienteDto.telefono_cliente,
    });
    if (existClienteByTelefono) {
        throw new BadRequestException('Ya existe un cliente con ese número de teléfono');
    }

    // Validar email
    const existClienteByEmail = await this.clienteModel.findOne({
        email_cliente: createClienteDto.email_cliente,
    });
    if (existClienteByEmail) {
        throw new BadRequestException('Ya existe un cliente con ese correo electrónico');
    }

    const nuevoCliente = new this.clienteModel(datos);
    return nuevoCliente.save();
}



  //Buscar todos los clientes
  async findAll(): Promise<Cliente[]> {
    return this.clienteModel
      .find()
      .sort({ createdAt: -1 })
      .exec();
  }



  // Buscar un cliente
  async findOne(id:string): Promise<Cliente> {
  const cli = await this.clienteModel.findById(id).exec();
  if (!cli){
    throw new NotFoundException('No se encontró el cliente');
  }
  return cli;
 }


 //Actualizar un cliente
  async update( id: string, UpdateClienteDto: UpdateClienteDto): Promise<Cliente> {
  const cambios: Record<string, unknown> = { ...UpdateClienteDto };

  if (
    UpdateClienteDto.tipoIdentidad !== undefined ||
    UpdateClienteDto.id_cliente !== undefined ||
    UpdateClienteDto.nit !== undefined
  ) {
    const actual = await this.clienteModel.findById(id).lean().exec();
    if (!actual) {
      throw new NotFoundException('No se encontró el cliente');
    }

    const tipo = UpdateClienteDto.tipoIdentidad ?? actual.tipoIdentidad ?? 'CI';
    const nitNuevo = UpdateClienteDto.nit ?? actual.nit;
    // En un cliente NIT, su documento (`id_cliente`) acompaña al NIT si eran el mismo.
    const idNuevo =
      UpdateClienteDto.id_cliente ??
      (tipo === 'NIT' && nitNuevo && actual.id_cliente === (actual.nit ?? actual.id_cliente)
        ? nitNuevo
        : actual.id_cliente);

    // Solo se comprueba lo que cambia: una CI anterior mal escrita no impide
    // editar el resto de los datos del cliente.
    const cambiaIdentidad =
      tipo !== (actual.tipoIdentidad ?? 'CI') ||
      idNuevo !== actual.id_cliente ||
      nitNuevo !== actual.nit;

    if (cambiaIdentidad) {
      Object.assign(
        cambios,
        this.validarIdentidad(tipo, idNuevo, nitNuevo),
        { tipoIdentidad: tipo },
      );
    }
  }

  const updatecli = await this.clienteModel.findByIdAndUpdate(id, cambios, {new :true}).exec();

  if (!updatecli) {
    throw new NotFoundException('No se encontró el cliente');
  }
  return updatecli;
}

//Eliminar un cliente

 async remove(id: string): Promise<void>{
  const deletecli = await this.clienteModel.findByIdAndDelete(id);

  if (!deletecli) {
    throw new NotFoundException('No se encontró el cliente');
  }
}
}
