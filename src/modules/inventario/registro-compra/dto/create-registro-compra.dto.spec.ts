import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateRegistroCompraDto } from './create-registro-compra.dto';

// Misma configuración que en main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta: ArgumentMetadata = {
  type: 'body',
  metatype: CreateRegistroCompraDto,
};

const valido = () => ({
  producto: new Types.ObjectId().toString(),
  almacen: new Types.ObjectId().toString(),
  contenedor: new Types.ObjectId().toString(),
  cantidad: 5,
  costo_unitario: 2.5,
  fecha: '2026-10-05',
});

const mensajes = async (body: unknown): Promise<string[]> => {
  try {
    await pipe.transform(body, meta);
    return [];
  } catch (error) {
    const respuesta = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return respuesta.message;
  }
};

describe('CreateRegistroCompraDto', () => {
  it('acepta el cuerpo que envía el formulario', async () => {
    expect(await mensajes(valido())).toEqual([]);
  });

  it('la fecha es opcional', async () => {
    const { fecha: _fecha, ...sinFecha } = valido();
    expect(await mensajes(sinFecha)).toEqual([]);
  });

  it('acepta costo 0', async () => {
    expect(await mensajes({ ...valido(), costo_unitario: 0 })).toEqual([]);
  });

  it.each([0, -3])('rechaza una cantidad menor que 1 (%s)', async (cantidad) => {
    expect(await mensajes({ ...valido(), cantidad })).toContain(
      'La cantidad debe ser al menos 1',
    );
  });

  it('rechaza una cantidad decimal', async () => {
    expect(await mensajes({ ...valido(), cantidad: 1.5 })).toContain(
      'La cantidad debe ser un número entero',
    );
  });

  it('rechaza un costo negativo', async () => {
    expect(await mensajes({ ...valido(), costo_unitario: -1 })).toContain(
      'El costo unitario no puede ser negativo',
    );
  });

  it('rechaza IDs que no son de MongoDB', async () => {
    const m = await mensajes({
      ...valido(),
      producto: 'abc',
      almacen: '123',
      contenedor: 'xyz',
    });
    expect(m).toEqual(
      expect.arrayContaining([
        'El producto debe ser un ID de MongoDB válido',
        'El almacén debe ser un ID de MongoDB válido',
        'El contenedor debe ser un ID de MongoDB válido',
      ]),
    );
  });

  it('rechaza una fecha inválida', async () => {
    expect(await mensajes({ ...valido(), fecha: 'ayer' })).toContain(
      'La fecha debe ser una fecha válida',
    );
  });

  it('rechaza campos que el cliente no debe enviar, como el total', async () => {
    expect(await mensajes({ ...valido(), total: 9999 })).toContain(
      'property total should not exist',
    );
  });

  it('exige todos los campos obligatorios', async () => {
    const m = await mensajes({});
    expect(m).toEqual(
      expect.arrayContaining([
        'El producto es obligatorio',
        'El almacén es obligatorio',
        'El contenedor es obligatorio',
        'La cantidad es obligatoria',
        'El costo unitario es obligatorio',
      ]),
    );
  });
});
