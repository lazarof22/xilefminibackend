import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { LicenciaService } from '../licencia/licencia.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import {
  COLLATION_NOMBRE,
  ModuloApp,
  UsuarioRol,
  Usuarios,
  UsuariosDocument,
  modulosEfectivos,
} from './schemas/usuarios.schema';

export interface UsuarioListado {
  _id: string;
  nombre: string;
  rol: UsuarioRol;
  /** Módulos efectivos (todos si es administrador). */
  modulos: ModuloApp[];
  createdAt?: Date;
}

const SALT_ROUNDS = 10;
/** Índices únicos del esquema anterior (empleado): bloquearían nuevas altas. */
const INDICES_ANTIGUOS = ['correo_empleado_1', 'ci_empleado_1'];
const MONGO_DUPLICADO = 11000;

function aListado(u: UsuariosDocument): UsuarioListado {
  return {
    _id: String(u._id),
    nombre: u.nombre,
    rol: u.rol,
    modulos: modulosEfectivos(u),
    createdAt: (u as unknown as { createdAt?: Date }).createdAt,
  };
}

function esDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === MONGO_DUPLICADO
  );
}

@Injectable()
export class UsuariosService implements OnModuleInit {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectModel(Usuarios.name)
    private readonly usuarioModel: Model<UsuariosDocument>,
    private readonly licenciaService: LicenciaService,
  ) {}

  /**
   * Migración suave desde el esquema anterior: elimina sus índices únicos y
   * avisa si quedan usuarios antiguos (sin `nombre`) que ya no pueden entrar.
   */
  async onModuleInit(): Promise<void> {
    try {
      const existentes = await this.usuarioModel.collection.indexes();
      for (const { name } of existentes) {
        if (name && INDICES_ANTIGUOS.includes(name)) {
          await this.usuarioModel.collection.dropIndex(name);
          this.logger.log(`Índice antiguo "${name}" eliminado de usuarios`);
        }
      }
      const antiguos = await this.usuarioModel
        .countDocuments({ nombre: { $exists: false } })
        .exec();
      if (antiguos > 0) {
        this.logger.warn(
          `Hay ${antiguos} usuario(s) del esquema anterior sin "nombre" que no pueden iniciar sesión. ` +
            'Ejecute: npm run crear-admin -- <nombre> <contraseña> --limpiar-antiguos',
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo revisar la colección usuarios: ${(error as Error).message}`,
      );
    }
  }

  async findAll(): Promise<UsuarioListado[]> {
    const usuarios = await this.usuarioModel
      .find()
      .collation(COLLATION_NOMBRE)
      .sort({ nombre: 1 })
      .exec();
    return usuarios.map(aListado);
  }

  async create(dto: CreateUsuarioDto): Promise<UsuarioListado> {
    await this.asegurarNombreLibre(dto.nombre);

    // Tope de usuarios de la licencia (compartido con el resto de rutas de alta).
    const creado = await this.licenciaService.crearUsuarioConCupo(undefined, {
      contar: () => this.usuarioModel.countDocuments({}).exec(),
      crear: () => this.insertar(dto),
      eliminar: async (doc) => {
        await this.usuarioModel.deleteOne({ _id: doc._id }).exec();
      },
    });
    return aListado(creado);
  }

  private async insertar(dto: CreateUsuarioDto): Promise<UsuariosDocument> {
    const contraseña = await bcrypt.hash(dto.contraseña, SALT_ROUNDS);
    try {
      return await this.usuarioModel.create({
        nombre: dto.nombre,
        contraseña,
        rol: dto.rol,
        modulos: dto.modulos ?? [],
      });
    } catch (error) {
      if (esDuplicado(error)) throw this.nombreEnUso();
      throw error;
    }
  }

  async update(id: string, dto: UpdateUsuarioDto): Promise<UsuarioListado> {
    const usuario = await this.buscar(id);

    if (dto.nombre !== undefined && dto.nombre !== usuario.nombre) {
      await this.asegurarNombreLibre(dto.nombre, String(usuario._id));
      usuario.nombre = dto.nombre;
    }

    if (dto.rol !== undefined && dto.rol !== usuario.rol) {
      if (usuario.rol === UsuarioRol.ADMIN)
        await this.asegurarOtroAdmin(usuario);
      usuario.rol = dto.rol;
    }

    if (dto.modulos !== undefined) usuario.modulos = dto.modulos;

    if (dto.contraseña) {
      usuario.contraseña = await bcrypt.hash(dto.contraseña, SALT_ROUNDS);
    }

    try {
      await usuario.save();
    } catch (error) {
      if (esDuplicado(error)) throw this.nombreEnUso();
      throw error;
    }
    return aListado(usuario);
  }

  async remove(id: string, actorId: string): Promise<{ deleted: boolean }> {
    const usuario = await this.buscar(id);
    if (String(usuario._id) === actorId) {
      throw new BadRequestException('No puede eliminar su propia cuenta');
    }
    if (usuario.rol === UsuarioRol.ADMIN) await this.asegurarOtroAdmin(usuario);

    await this.usuarioModel.deleteOne({ _id: usuario._id }).exec();
    return { deleted: true };
  }

  // ─── helpers ───────────────────────────────────────────

  private async buscar(id: string): Promise<UsuariosDocument> {
    if (!isValidObjectId(id))
      throw new NotFoundException('Usuario no encontrado');
    const usuario = await this.usuarioModel
      .findById(id)
      .select('+contraseña')
      .exec();
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    return usuario;
  }

  private async asegurarNombreLibre(
    nombre: string,
    exceptoId?: string,
  ): Promise<void> {
    const existente = await this.usuarioModel
      .findOne({ nombre })
      .collation(COLLATION_NOMBRE)
      .select('_id')
      .lean()
      .exec();
    if (existente && String(existente._id) !== (exceptoId ?? '')) {
      throw this.nombreEnUso();
    }
  }

  /** Impide dejar la instalación sin ningún administrador. */
  private async asegurarOtroAdmin(usuario: UsuariosDocument): Promise<void> {
    const otros = await this.usuarioModel
      .countDocuments({ rol: UsuarioRol.ADMIN, _id: { $ne: usuario._id } })
      .exec();
    if (otros === 0) {
      throw new BadRequestException(
        'Debe existir al menos un administrador. Cree otro antes de continuar.',
      );
    }
  }

  private nombreEnUso(): ConflictException {
    return new ConflictException('Ya existe un usuario con ese nombre');
  }
}
