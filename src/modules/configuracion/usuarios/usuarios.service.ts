import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { Usuario, UsuarioDocument } from '../../auth/schemas/empleado.schema';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { NomencladorHelper } from '../nomenclador-helper/nomenclador-helper.service';
import { LicenciaService } from '../../licencia/licencia.service';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectModel(Usuario.name)
    private readonly usuarioModel: Model<UsuarioDocument>,
    private readonly nomencladorHelper: NomencladorHelper,
    private readonly licenciaService: LicenciaService,
  ) {}

  async findAll(): Promise<UsuarioDocument[]> {
    return this.usuarioModel.find().select('-contraseña').sort({ createdAt: -1 }).lean().exec() as unknown as UsuarioDocument[];
  }

  async create(dto: CreateUsuarioDto): Promise<UsuarioDocument> {
    const exists = await this.usuarioModel.findOne({ correo_empleado: dto.correo_empleado });
    if (exists) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }
    const ciExists = await this.usuarioModel.findOne({ ci_empleado: dto.ci_empleado });
    if (ciExists) {
      throw new ConflictException('Ya existe un usuario con esa cédula');
    }

    // License user cap (same semantics as AuthService.register). Users created
    // here carry no empresa_id, so they count against the install-wide license.
    // Only enforced when a valid license exists.
    const usuariosActuales = await this.usuarioModel.countDocuments({}).exec();
    await this.licenciaService.assertCupoUsuarios(undefined, usuariosActuales);

    let departamentoId: Types.ObjectId;
    if (this.nomencladorHelper.isObjectId(dto.departamento)) {
      departamentoId = new Types.ObjectId(dto.departamento);
    } else {
      departamentoId = await this.nomencladorHelper.findOrCreateDepartamento(dto.departamento);
    }

    let cargoId: Types.ObjectId;
    if (this.nomencladorHelper.isObjectId(dto.cargo)) {
      cargoId = new Types.ObjectId(dto.cargo);
    } else {
      cargoId = await this.nomencladorHelper.findOrCreateCargoEmpleado(dto.cargo);
    }

    const hashedPassword = await bcrypt.hash(dto.contraseña, 10);
    const created = await this.usuarioModel.create({
      ...dto,
      departamento: departamentoId,
      cargo: cargoId,
      contraseña: hashedPassword,
    });
    const obj = created.toObject() as unknown as Record<string, unknown>;
    delete obj.contraseña;
    return obj as unknown as UsuarioDocument;
  }

  async remove(id: string): Promise<void> {
    const result = await this.usuarioModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Usuario no encontrado');
    }
  }
}
