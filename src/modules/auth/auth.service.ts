import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { JWT_SECRET, JWT_EXPIRES_IN } from './constants/constants';
import { Usuario } from './schemas/empleado.schema';
import { CreateAuthDto } from './dto/create-auth.dto';
import { CargoEmpleado } from '../nomencladores/cargo_empleado/schema/cargo_empleado.schema';
import { Departamento } from '../nomencladores/departamento/schema/departamento.schema';
import { LicenciaService } from '../licencia/licencia.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Usuario.name) private userModel: Model<Usuario>,
    @InjectModel(Departamento.name) private departamentoModel: Model<Departamento>,@InjectModel(CargoEmpleado.name) private cargoModel: Model<CargoEmpleado>,
    private jwtService: JwtService,
    private readonly licenciaService: LicenciaService,
  ) { }


  async findAll(): Promise<Usuario[]> {
    return this.userModel
      .find()
      .select('-contraseña')
      .sort({ createdAt: -1 })
      .exec();
  }

  async register(createAuthDto: CreateAuthDto): Promise<{ access_token: string }> {
    const { ci_empleado, nombre_empleado, correo_empleado, contraseña, departamento, cargo, salario, rol, empresa_id } = createAuthDto;
    await this.assertCupoUsuarios(empresa_id?.toString());
    const hashedPassword = await bcrypt.hash(contraseña, 10);
    const user = new this.userModel({
      ci_empleado,
      nombre_empleado,
      correo_empleado,
      contraseña: hashedPassword,
      departamento,
      cargo,
      salario,
      rol: rol || 'empleado',
      ...(empresa_id ? { empresa_id } : {}),
    });
    const savedUser = await user.save();

    // Genera el token igual que en login
    const payload = { correo_empleado: savedUser.correo_empleado, sub: savedUser._id, rol: savedUser.rol, nombre_empleado: savedUser.nombre_empleado, empresa_id: (savedUser as any).empresa_id?.toString() ?? undefined };
    const access_token = this.jwtService.sign(payload, {
      secret: JWT_SECRET,
      expiresIn: JWT_EXPIRES_IN,
    });

    return { access_token };
  }

  /**
   * Enforces the license `max_usuarios` cap before creating a user. Counts the
   * users of the empresa (or of the whole install when no empresa is given).
   * Only enforced when a valid license exists (see LicenciaService).
   */
  private async assertCupoUsuarios(empresaId: string | undefined): Promise<void> {
    const filter = empresaId ? { empresa_id: empresaId } : {};
    const usuariosActuales = await this.userModel.countDocuments(filter).exec();
    await this.licenciaService.assertCupoUsuarios(empresaId, usuariosActuales);
  }

  async validateUser(correo_empleado: string, contraseña: string): Promise<any> {
    const user = await this.userModel.findOne({ correo_empleado }).select('+contraseña');
    if (user && (await bcrypt.compare(contraseña, user.contraseña))) {
      const { contraseña, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async login(usuario: any) {
    const payload = { correo_empleado: usuario.correo_empleado, sub: usuario._id, rol: usuario.rol, nombre_empleado: usuario.nombre_empleado, empresa_id: usuario.empresa_id?.toString() ?? undefined };
    return {
      access_token: this.jwtService.sign(payload, {
        secret: JWT_SECRET,
        expiresIn: JWT_EXPIRES_IN,
      }),
    };
  }

  async validateUserById(userId: string) {
    return this.userModel.findById(userId).select('-contraseña');
  }
}