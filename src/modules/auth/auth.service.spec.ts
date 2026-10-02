import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { AuthService } from './auth.service';
import { Usuario } from './schemas/empleado.schema';
import { CreateAuthDto } from './dto/create-auth.dto';
import { CupoUsuariosOps, LicenciaService } from '../licencia/licencia.service';
import { CargoEmpleado } from '../nomencladores/cargo_empleado/schema/cargo_empleado.schema';
import { Departamento } from '../nomencladores/departamento/schema/departamento.schema';

describe('AuthService.register — license user cap', () => {
  const save = jest.fn();
  const countDocuments = jest.fn();
  const deleteOne = jest.fn();
  const crearUsuarioConCupo = jest.fn();

  // Mongoose model stand-in: constructible (`new this.userModel(...)`) with
  // static `countDocuments` / `deleteOne`.
  const UserModel = Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      save,
    })),
    { countDocuments, deleteOne },
  );

  let service: AuthService;
  const dto = {
    ci_empleado: '1',
    nombre_empleado: 'Ana',
    correo_empleado: 'ana@x.com',
    contraseña: 'secret123',
    departamento: 'd',
    cargo: 'c',
    salario: 1,
    rol: 'empleado',
    empresa_id: '507f1f77bcf86cd799439011',
  } as unknown as CreateAuthDto;

  type Ops = CupoUsuariosOps<{ _id: string }>;

  /** Runs the ops like LicenciaService would with a valid capped license. */
  function runOps(): void {
    crearUsuarioConCupo.mockImplementation(
      async (_empresa: string | undefined, ops: Ops) => {
        await ops.contar();
        const creado = await ops.crear();
        await ops.eliminar(creado);
        return creado;
      },
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    save.mockResolvedValue({
      _id: 'u1',
      correo_empleado: 'ana@x.com',
      rol: 'empleado',
    });
    countDocuments.mockReturnValue({ exec: () => Promise.resolve(2) });
    deleteOne.mockReturnValue({ exec: () => Promise.resolve({}) });
    crearUsuarioConCupo.mockImplementation(
      (_empresa: string | undefined, ops: Ops) => ops.crear(),
    );
    service = new AuthService(
      UserModel as unknown as Model<Usuario>,
      {} as Model<Departamento>,
      {} as Model<CargoEmpleado>,
      { sign: jest.fn().mockReturnValue('token') } as unknown as JwtService,
      { crearUsuarioConCupo } as unknown as LicenciaService,
    );
  });

  it('creates the user through the license cap helper, scoped to the empresa', async () => {
    runOps();
    await service.register(dto);
    expect(crearUsuarioConCupo).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      expect.any(Object),
    );
    expect(countDocuments).toHaveBeenCalledWith({
      empresa_id: '507f1f77bcf86cd799439011',
    });
    expect(save).toHaveBeenCalled();
    expect(deleteOne).toHaveBeenCalledWith({ _id: 'u1' });
  });

  it.each([undefined, '', '   '])(
    'counts every user of the install when the empresa is %p',
    async (empresa_id) => {
      runOps();
      await service.register({
        ...dto,
        empresa_id,
      } as unknown as CreateAuthDto);
      expect(crearUsuarioConCupo).toHaveBeenCalledWith(
        undefined,
        expect.any(Object),
      );
      expect(countDocuments).toHaveBeenCalledWith({});
    },
  );

  it('does not create the user when the cap helper rejects', async () => {
    crearUsuarioConCupo.mockRejectedValue(new ForbiddenException());
    await expect(service.register(dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(save).not.toHaveBeenCalled();
  });
});
