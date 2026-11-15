import { ForbiddenException } from '@nestjs/common';
import { ClienteController } from './cliente.controller';
import type { ClienteService } from './cliente.service';
import type { CreateClienteDto } from './dto/create-cliente.dto';
import type { UpdateClienteDto } from './dto/update-cliente.dto';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';

/**
 * A client with a discount gets an automatic discount on every sale that the
 * cashier cannot give by hand (doc 6.9): only administrador and gerente may
 * create or edit that condition.
 */
function escenario() {
  const servicio = {
    create: jest.fn((dto: unknown) => Promise.resolve(dto)),
    update: jest.fn((_id: string, dto: unknown) => Promise.resolve(dto)),
  };
  const controlador = new ClienteController(
    servicio as unknown as ClienteService,
  );
  const peticion = (rol: string): RequestWithUser => ({
    user: { userId: 'u1', nombre: 'Ana', rol, modulos: [] },
  });
  return { servicio, controlador, peticion };
}

const conDescuento = {
  tipo_cliente: 'cliente_descuento',
  descuentoPct: 100,
} as unknown as CreateClienteDto;
const estandar = {
  tipo_cliente: 'cliente_estandar',
} as unknown as CreateClienteDto;

describe('ClienteController: client discount is a supervisor decision', () => {
  it.each(['cajero', 'facturador', 'empleado', 'economico', 'jefe'])(
    '%s cannot create a discount client (403) but can create a standard one',
    async (rol) => {
      const { controlador, peticion, servicio } = escenario();
      expect(() => controlador.create(conDescuento, peticion(rol))).toThrow(
        ForbiddenException,
      );
      expect(servicio.create).not.toHaveBeenCalled();
      await controlador.create(estandar, peticion(rol));
      expect(servicio.create).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['administrador', 'gerente'])(
    '%s can create a discount client',
    async (rol) => {
      const { controlador, peticion, servicio } = escenario();
      await controlador.create(conDescuento, peticion(rol));
      expect(servicio.create).toHaveBeenCalledTimes(1);
    },
  );

  it('a cajero cannot turn a client into a discount one or set descuentoPct on update', async () => {
    const { controlador, peticion, servicio } = escenario();
    expect(() =>
      controlador.update(
        'id1',
        { tipo_cliente: 'cliente_descuento' } as unknown as UpdateClienteDto,
        peticion('cajero'),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      controlador.update(
        'id1',
        { descuentoPct: 50 } as unknown as UpdateClienteDto,
        peticion('cajero'),
      ),
    ).toThrow(ForbiddenException);
    expect(servicio.update).not.toHaveBeenCalled();
  });

  it('a cajero can still edit the other fields of a client', async () => {
    const { controlador, peticion, servicio } = escenario();
    await controlador.update(
      'id1',
      { telefono_cliente: '55512345' } as unknown as UpdateClienteDto,
      peticion('cajero'),
    );
    expect(servicio.update).toHaveBeenCalledTimes(1);
  });
});
