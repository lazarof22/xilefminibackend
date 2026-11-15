import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductoController } from './producto.controller';
import type { ProductoService } from './producto.service';
import type { UpdateProductoDto } from './dto/update-producto.dto';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';

/**
 * Design document §6.9: only administrador and gerente may change a product's
 * selling price ("cambio de precio"). Any other field stays editable by every
 * authenticated user.
 */
const ID = '64b000000000000000000010';

function escenario(precioGuardado: number | null = 100) {
  const servicio = {
    findOne: jest.fn((): Promise<unknown> =>
      precioGuardado === null
        ? Promise.reject(new NotFoundException('No se encontró el producto'))
        : Promise.resolve({ _id: ID, precio_venta: precioGuardado }),
    ),
    update: jest.fn((_id: string, dto: unknown) => Promise.resolve(dto)),
  };
  const controlador = new ProductoController(
    servicio as unknown as ProductoService,
  );
  const peticion = (rol: string): RequestWithUser => ({
    user: { userId: 'u1', nombre: 'Ana', rol, modulos: [] },
  });

  return { servicio, controlador, peticion };
}

const dto = (datos: Record<string, unknown>) => datos as UpdateProductoDto;

describe('ProductoController.update — cambio de precio (§6.9)', () => {
  it.each(['cajero', 'empleado', 'jefe', 'economico', 'facturador'])(
    'el rol %s no puede cambiar el precio de venta (403)',
    async (rol) => {
      const { servicio, controlador, peticion } = escenario(100);

      const promesa = controlador.update(
        ID,
        dto({ precio_venta: 120 }),
        peticion(rol),
      );

      await expect(promesa).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promesa).rejects.toThrow(
        'Solo el administrador o el gerente pueden cambiar el precio de venta',
      );
      expect(servicio.update).not.toHaveBeenCalled();
    },
  );

  it.each(['administrador', 'gerente'])(
    'el %s puede cambiar el precio de venta',
    async (rol) => {
      const { servicio, controlador, peticion } = escenario(100);

      await controlador.update(ID, dto({ precio_venta: 120 }), peticion(rol));

      expect(servicio.update).toHaveBeenCalledWith(ID, { precio_venta: 120 });
    },
  );

  it('reenviar el mismo precio guardado no cuenta como cambio', async () => {
    const { servicio, controlador, peticion } = escenario(100);

    await controlador.update(
      ID,
      dto({ precio_venta: 100, nombre_producto: 'Arroz' }),
      peticion('cajero'),
    );

    expect(servicio.update).toHaveBeenCalledTimes(1);
  });

  it('un cajero puede editar los demás campos sin leer el producto', async () => {
    const { servicio, controlador, peticion } = escenario(100);

    await controlador.update(
      ID,
      dto({ nombre_producto: 'Arroz extra' }),
      peticion('cajero'),
    );

    expect(servicio.findOne).not.toHaveBeenCalled();
    expect(servicio.update).toHaveBeenCalledWith(ID, {
      nombre_producto: 'Arroz extra',
    });
  });

  it('un administrador no necesita leer el producto para cambiar el precio', async () => {
    const { servicio, controlador, peticion } = escenario(100);

    await controlador.update(
      ID,
      dto({ precio_venta: 5 }),
      peticion('administrador'),
    );

    expect(servicio.findOne).not.toHaveBeenCalled();
  });

  it('si el producto no existe, el cajero recibe el 404 (no un 403)', async () => {
    const { servicio, controlador, peticion } = escenario(null);

    await expect(
      controlador.update(ID, dto({ precio_venta: 5 }), peticion('cajero')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(servicio.update).not.toHaveBeenCalled();
  });

  it('un precio que no es un número válido no pasa la guarda: un cajero recibe 403', async () => {
    const { controlador, peticion, servicio } = escenario(100);

    await expect(
      controlador.update(
        ID,
        { precio_venta: Number.NaN } as unknown as UpdateProductoDto,
        peticion('cajero'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(servicio.update).not.toHaveBeenCalled();
  });
});
