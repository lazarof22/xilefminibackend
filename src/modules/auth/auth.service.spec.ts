import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { AuthService } from './auth.service';
import { Usuario } from './schemas/empleado.schema';
import { CreateAuthDto } from './dto/create-auth.dto';
import { LicenciaService } from '../licencia/licencia.service';
import { CargoEmpleado } from '../nomencladores/cargo_empleado/schema/cargo_empleado.schema';
import { Departamento } from '../nomencladores/departamento/schema/departamento.schema';

describe('AuthService.register — license user cap', () => {
  const save = jest.fn();
  const countDocuments = jest.fn();
  const assertCupoUsuarios = jest.fn();

  // Mongoose model stand-in: constructible (`new this.userModel(...)`) with a
  // static `countDocuments`.
  const UserModel = Object.assign(
    jest.fn().mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      save,
    })),
    { countDocuments },
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

  beforeEach(() => {
    jest.clearAllMocks();
    save.mockResolvedValue({
      _id: 'u1',
      correo_empleado: 'ana@x.com',
      rol: 'empleado',
    });
    countDocuments.mockReturnValue({ exec: () => Promise.resolve(2) });
    assertCupoUsuarios.mockResolvedValue(undefined);
    service = new AuthService(
      UserModel as unknown as Model<Usuario>,
      {} as Model<Departamento>,
      {} as Model<CargoEmpleado>,
      { sign: jest.fn().mockReturnValue('token') } as unknown as JwtService,
      { assertCupoUsuarios } as unknown as LicenciaService,
    );
  });

  it('checks the cap with the current user count of the empresa before saving', async () => {
    await service.register(dto);
    expect(countDocuments).toHaveBeenCalledWith({
      empresa_id: '507f1f77bcf86cd799439011',
    });
    expect(assertCupoUsuarios).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      2,
    );
    expect(save).toHaveBeenCalled();
  });

  it('counts every user of the install when no empresa is given', async () => {
    await service.register({ ...dto, empresa_id: undefined });
    expect(countDocuments).toHaveBeenCalledWith({});
    expect(assertCupoUsuarios).toHaveBeenCalledWith(undefined, 2);
  });

  it('does not create the user when the cap is reached', async () => {
    assertCupoUsuarios.mockRejectedValue(new ForbiddenException());
    await expect(service.register(dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(save).not.toHaveBeenCalled();
  });
});
