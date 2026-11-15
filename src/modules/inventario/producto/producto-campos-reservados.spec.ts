import { ForbiddenException } from '@nestjs/common';
import { ProductoController } from './producto.controller';
import type { ProductoService } from './producto.service';
import type { UpdateProductoDto } from './dto/update-producto.dto';
import type { RequestWithUser } from '../../auth/types/jwt-user.type';

/**
 * Cost and stock of an existing product are changed only by administrador and
 * gerente: stock is corrected with an inventory adjustment that carries a
 * cause (design document §9), never by editing the product.
 */
const ID = '64b000000000000000000010';
const GUARDADO = {
  _id: ID,
  precio_venta: 100,
  precio_compra: 60,
  stock_inicial: 10,
};

function escenario() {
  const servicio = {
    findOne: jest.fn(() => Promise.resolve(GUARDADO)),
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

describe('ProductoController.update — costo y stock reservados', () => {
  it.each([
    ['stock_inicial', 999, /stock/],
    ['precio_compra', 1, /costo/],
  ])(
    'un cajero no cambia %s (403) y no se guarda nada',
    async (campo, valor, mensaje) => {
      const { servicio, controlador, peticion } = escenario();

      const promesa = controlador.update(
        ID,
        dto({ [campo]: valor }),
        peticion('cajero'),
      );

      await expect(promesa).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promesa).rejects.toThrow(mensaje);
      expect(servicio.update).not.toHaveBeenCalled();
    },
  );

  it.each(['administrador', 'gerente'])(
    'el %s cambia el costo y el stock',
    async (rol) => {
      const { servicio, controlador, peticion } = escenario();

      await controlador.update(
        ID,
        dto({ stock_inicial: 50, precio_compra: 70 }),
        peticion(rol),
      );

      expect(servicio.update).toHaveBeenCalledWith(ID, {
        stock_inicial: 50,
        precio_compra: 70,
      });
    },
  );

  it('reenviar la ficha completa con los mismos valores no se bloquea', async () => {
    const { servicio, controlador, peticion } = escenario();

    await controlador.update(
      ID,
      dto({
        precio_venta: 100,
        precio_compra: 60,
        stock_inicial: 10,
        nombre_producto: 'Arroz',
      }),
      peticion('cajero'),
    );

    expect(servicio.update).toHaveBeenCalledTimes(1);
  });

  it('un valor que no es un número no pasa la guarda', async () => {
    const { controlador, peticion } = escenario();

    await expect(
      controlador.update(
        ID,
        dto({ stock_inicial: Number.NaN }),
        peticion('cajero'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
