/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Doc, FakeModel } from '../../inventario/exitencia/fake-mongo-spec';
import { ClienteService } from './cliente.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';

/**
 * Identidad del cliente (Fase 3): se identifica con CI (11 dígitos) o con NIT,
 * y el crédito del punto de venta lee de aquí su documento. El servicio y el
 * pago comparten las mismas reglas (`common/utils/identidad.ts`).
 */

const CI = '90010112345';

const datosBase = (extra: Partial<CreateClienteDto> = {}): CreateClienteDto =>
  ({
    nombre_cliente: 'Juan Pérez',
    telefono_cliente: '53456789',
    email_cliente: 'juan@correo.cu',
    direccion_cliente: 'Calle 1 #23, La Habana',
    tipo_cliente: 'cliente_estandar',
    id_cliente: CI,
    ...extra,
  }) as CreateClienteDto;

/** El modelo de Mongoose (constructor + consultas) sobre una colección en memoria. */
function crearServicio(existentes: Doc[] = []) {
  const coleccion = new FakeModel(existentes);
  const findByIdAndUpdate = jest.fn(
    (id: unknown, cambios: Doc, opciones: Doc) =>
      coleccion.findByIdAndUpdate(id, cambios, opciones),
  );
  const modelo = Object.assign(
    jest.fn().mockImplementation((datos: Doc) => ({
      save: () => Promise.resolve(coleccion.insertar(datos)),
    })),
    {
      findOne: (filtro: Doc) => coleccion.findOne(filtro),
      findById: jest.fn((id: unknown) => coleccion.findById(id)),
      findByIdAndUpdate,
    },
  );

  return {
    servicio: new ClienteService(modelo as never),
    coleccion,
    modelo,
    findByIdAndUpdate,
  };
}

async function fallo(promesa: Promise<unknown>): Promise<Error> {
  try {
    await promesa;
  } catch (e) {
    return e as Error;
  }
  throw new Error('Se esperaba un error y no lo hubo');
}

describe('ClienteService — identidad con CI o NIT', () => {
  describe('create', () => {
    it('sin indicar el tipo de identidad es CI y guarda el documento recortado', async () => {
      const { servicio, coleccion } = crearServicio();

      await servicio.create(datosBase({ id_cliente: `  ${CI} ` }));

      expect(coleccion.docs).toHaveLength(1);
      expect(coleccion.docs[0]).toMatchObject({
        id_cliente: CI,
        tipoIdentidad: 'CI',
        nombre_cliente: 'Juan Pérez',
        tipo_cliente: 'cliente_estandar',
      });
      expect(coleccion.docs[0].nit).toBeUndefined();
    });

    it('guarda el prefijo de país que se indique', async () => {
      const { servicio, coleccion } = crearServicio();

      await servicio.create(datosBase({ codigoPais: '+1' }));

      expect(coleccion.docs[0].codigoPais).toBe('+1');
    });

    it('la CI es obligatoria cuando el cliente se identifica con CI', async () => {
      const { servicio, coleccion } = crearServicio();

      const error = await fallo(
        servicio.create(datosBase({ id_cliente: undefined })),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('La CI del cliente es obligatoria');
      expect(coleccion.docs).toHaveLength(0);
    });

    it.each([
      ['10 dígitos', '9001011234'],
      ['12 dígitos', '900101123456'],
      ['letras', '9001011234a'],
      ['espacios en medio', '900 1011 2345'],
      ['guiones', '900101-12345'],
    ])('rechaza una CI con %s', async (_motivo, ci) => {
      const { servicio, coleccion } = crearServicio();

      const error = await fallo(servicio.create(datosBase({ id_cliente: ci })));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(
        'La CI debe tener exactamente 11 dígitos numéricos',
      );
      expect(coleccion.docs).toHaveLength(0);
    });

    it('con NIT, el NIT es el documento del cliente (id_cliente) y se guarda aparte', async () => {
      const { servicio, coleccion } = crearServicio();

      await servicio.create(
        datosBase({
          tipoIdentidad: 'NIT',
          nit: ' NIT-2024-001 ',
          id_cliente: undefined,
        }),
      );

      expect(coleccion.docs[0]).toMatchObject({
        tipoIdentidad: 'NIT',
        nit: 'NIT-2024-001',
        id_cliente: 'NIT-2024-001',
      });
    });

    it('con NIT y un documento propio, se conserva el documento', async () => {
      const { servicio, coleccion } = crearServicio();

      await servicio.create(
        datosBase({
          tipoIdentidad: 'NIT',
          nit: 'NIT-2024-001',
          id_cliente: 'EMP-1',
        }),
      );

      expect(coleccion.docs[0]).toMatchObject({
        id_cliente: 'EMP-1',
        nit: 'NIT-2024-001',
      });
    });

    it('con NIT, el NIT es obligatorio y debe ser razonable', async () => {
      const { servicio } = crearServicio();

      const sinNit = await fallo(
        servicio.create(
          datosBase({ tipoIdentidad: 'NIT', id_cliente: undefined }),
        ),
      );
      const corto = await fallo(
        servicio.create(
          datosBase({ tipoIdentidad: 'NIT', nit: 'ab', id_cliente: undefined }),
        ),
      );
      const raro = await fallo(
        servicio.create(
          datosBase({
            tipoIdentidad: 'NIT',
            nit: 'NIT 2024 001',
            id_cliente: undefined,
          }),
        ),
      );

      expect(sinNit.message).toBe('El NIT del cliente es obligatorio');
      expect(corto.message).toBe(
        'El NIT debe tener de 5 a 20 letras, números o guiones',
      );
      expect(raro.message).toBe(
        'El NIT debe tener de 5 a 20 letras, números o guiones',
      );
    });

    it('un cliente con NIT no necesita CI: no se le exige el formato de la CI', async () => {
      const { servicio, coleccion } = crearServicio();

      await servicio.create(
        datosBase({
          tipoIdentidad: 'NIT',
          nit: 'ABC-12345',
          id_cliente: 'ABC-12345',
        }),
      );

      expect(coleccion.docs).toHaveLength(1);
    });

    it('no repite documento, teléfono ni correo', async () => {
      const { servicio } = crearServicio();
      await servicio.create(datosBase());

      const mismoId = await fallo(
        servicio.create(
          datosBase({ telefono_cliente: '1', email_cliente: 'otro@correo.cu' }),
        ),
      );
      const mismoTelefono = await fallo(
        servicio.create(
          datosBase({
            id_cliente: '85051512345',
            email_cliente: 'otro@correo.cu',
          }),
        ),
      );
      const mismoCorreo = await fallo(
        servicio.create(
          datosBase({ id_cliente: '85051512345', telefono_cliente: '2' }),
        ),
      );

      expect(mismoId.message).toBe('Ya existe un cliente con ese ID');
      expect(mismoTelefono.message).toBe(
        'Ya existe un cliente con ese número de teléfono',
      );
      expect(mismoCorreo.message).toBe(
        'Ya existe un cliente con ese correo electrónico',
      );
    });

    it('un NIT no puede repetir el documento de otro cliente', async () => {
      const { servicio } = crearServicio();
      await servicio.create(
        datosBase({
          id_cliente: 'ABC-12345',
          tipoIdentidad: 'NIT',
          nit: 'ABC-12345',
        }),
      );

      const error = await fallo(
        servicio.create(
          datosBase({
            tipoIdentidad: 'NIT',
            nit: 'ABC-12345',
            id_cliente: undefined,
            telefono_cliente: '2',
            email_cliente: 'otro@correo.cu',
          }),
        ),
      );

      expect(error.message).toBe('Ya existe un cliente con ese ID');
    });
  });

  describe('update', () => {
    const clienteCI: Doc = {
      id_cliente: CI,
      tipoIdentidad: 'CI',
      nombre_cliente: 'Juan Pérez',
      telefono_cliente: '53456789',
    };
    const clienteNIT: Doc = {
      id_cliente: 'ABC-12345',
      nit: 'ABC-12345',
      tipoIdentidad: 'NIT',
      nombre_cliente: 'Empresa SA',
      telefono_cliente: '72060000',
    };

    it('cambiar solo el nombre o el teléfono no toca la identidad ni la lee', async () => {
      const { servicio, coleccion, modelo } = crearServicio([clienteCI]);
      const id = coleccion.docs[0]._id;

      await servicio.update(String(id), {
        nombre_cliente: 'Juan P.',
        telefono_cliente: '5555',
      });

      expect(modelo.findById).not.toHaveBeenCalled();
      expect(coleccion.docs[0]).toMatchObject({
        nombre_cliente: 'Juan P.',
        telefono_cliente: '5555',
        id_cliente: CI,
      });
    });

    it('cambiar la CI valida el formato de la nueva', async () => {
      const { servicio, coleccion } = crearServicio([clienteCI]);
      const id = String(coleccion.docs[0]._id);

      const error = await fallo(servicio.update(id, { id_cliente: '123' }));
      await servicio.update(id, {
        id_cliente: '85051512345',
      });

      expect(error.message).toBe(
        'La CI debe tener exactamente 11 dígitos numéricos',
      );
      expect(coleccion.docs[0]).toMatchObject({
        id_cliente: '85051512345',
        tipoIdentidad: 'CI',
      });
    });

    it('pasar de CI a NIT: el NIT pasa a ser su documento', async () => {
      const { servicio, coleccion } = crearServicio([clienteCI]);

      await servicio.update(String(coleccion.docs[0]._id), {
        tipoIdentidad: 'NIT',
        nit: 'NIT-2024-001',
      });

      expect(coleccion.docs[0]).toMatchObject({
        tipoIdentidad: 'NIT',
        nit: 'NIT-2024-001',
        id_cliente: 'NIT-2024-001',
      });
    });

    it('pasar a NIT sin indicar el NIT se rechaza y no cambia nada', async () => {
      const { servicio, coleccion } = crearServicio([clienteCI]);

      const error = await fallo(
        servicio.update(String(coleccion.docs[0]._id), {
          tipoIdentidad: 'NIT',
        }),
      );

      expect(error.message).toBe('El NIT del cliente es obligatorio');
      expect(coleccion.docs[0].tipoIdentidad).toBe('CI');
    });

    it('cambiar el NIT de una empresa mueve también su documento', async () => {
      const { servicio, coleccion } = crearServicio([clienteNIT]);

      await servicio.update(String(coleccion.docs[0]._id), {
        nit: 'XYZ-99999',
      });

      expect(coleccion.docs[0]).toMatchObject({
        nit: 'XYZ-99999',
        id_cliente: 'XYZ-99999',
        tipoIdentidad: 'NIT',
      });
    });

    it('un NIT nuevo mal escrito se rechaza', async () => {
      const { servicio, coleccion } = crearServicio([clienteNIT]);

      const error = await fallo(
        servicio.update(String(coleccion.docs[0]._id), {
          nit: 'ab',
        }),
      );

      expect(error.message).toBe(
        'El NIT debe tener de 5 a 20 letras, números o guiones',
      );
      expect(coleccion.docs[0].nit).toBe('ABC-12345');
    });

    it('un cliente con una CI anterior mal escrita se puede editar mientras no se toque su identidad', async () => {
      const { servicio, coleccion } = crearServicio([
        { ...clienteCI, id_cliente: '123' },
      ]);
      const id = String(coleccion.docs[0]._id);

      // Reenviar el mismo tipo y la misma CI no es un cambio de identidad.
      await servicio.update(id, {
        tipoIdentidad: 'CI',
        id_cliente: '123',
        nombre_cliente: 'Juan Pérez G.',
      });

      expect(coleccion.docs[0]).toMatchObject({
        id_cliente: '123',
        nombre_cliente: 'Juan Pérez G.',
      });
    });

    it('un cliente que no existe: 404', async () => {
      const { servicio } = crearServicio();

      await expect(
        servicio.update('64b0000000000000000000aa', {
          id_cliente: CI,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        servicio.update('64b0000000000000000000aa', {
          nombre_cliente: 'X',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('CreateClienteDto', () => {
  const valido = {
    nombre_cliente: 'Juan Pérez',
    telefono_cliente: '53456789',
    email_cliente: 'juan@correo.cu',
    direccion_cliente: 'Calle 1 #23',
    tipo_cliente: 'cliente_estandar',
  };

  const propiedadesConError = async (datos: Record<string, unknown>) =>
    (
      await validate(plainToInstance(CreateClienteDto, { ...valido, ...datos }))
    ).map((e) => e.property);

  it('acepta los tres tipos de cliente que ofrece la pantalla de "Nuevo cliente"', async () => {
    for (const tipo of [
      'cliente_estandar',
      'cliente_descuento',
      'cliente_cuenta_casa',
    ]) {
      // The discount client also needs its discount (§6.8).
      expect(
        await propiedadesConError({ tipo_cliente: tipo, descuentoPct: 10 }),
      ).toEqual([]);
    }
  });

  it('rechaza un tipo de cliente que no existe (antes fallaba recién al guardar)', async () => {
    expect(
      await propiedadesConError({ tipo_cliente: 'Cliente estándar' }),
    ).toEqual(['tipo_cliente']);
    expect(await propiedadesConError({ tipo_cliente: undefined })).toEqual([
      'tipo_cliente',
    ]);
  });

  it('la identidad es opcional en el DTO (la comprueba el servicio según el tipo)', async () => {
    expect(await propiedadesConError({})).toEqual([]);
    expect(
      await propiedadesConError({ tipoIdentidad: 'NIT', nit: 'NIT-2024-001' }),
    ).toEqual([]);
  });

  it('el tipo de identidad solo puede ser CI o NIT', async () => {
    expect(await propiedadesConError({ tipoIdentidad: 'RUC' })).toEqual([
      'tipoIdentidad',
    ]);
  });

  it.each([
    ['+53', true],
    ['+1', true],
    ['+1234', true],
    ['53', false],
    ['+', false],
    ['+12345', false],
    ['+5 3', false],
  ])('el prefijo de país "%s" es válido: %s', async (prefijo, valido) => {
    const errores = await propiedadesConError({ codigoPais: prefijo });

    expect(errores).toEqual(valido ? [] : ['codigoPais']);
  });
});

/**
 * Design document §6.8: a "cliente con descuento" carries a fixed discount (%)
 * that the point of sale applies automatically. `descuentoPct` only exists for
 * that client type.
 */
describe('descuentoPct del cliente con descuento', () => {
  const valido = {
    nombre_cliente: 'Juan Pérez',
    telefono_cliente: '53456789',
    email_cliente: 'juan@correo.cu',
    direccion_cliente: 'Calle 1 #23',
    tipo_cliente: 'cliente_descuento',
  };

  const errores = async (
    clase: typeof CreateClienteDto | typeof UpdateClienteDto,
    datos: Record<string, unknown>,
  ) =>
    (await validate(plainToInstance(clase, { ...valido, ...datos }))).map(
      (e) => e.property,
    );

  describe('DTO', () => {
    it('un cliente con descuento exige descuentoPct', async () => {
      expect(await errores(CreateClienteDto, {})).toEqual(['descuentoPct']);
    });

    it.each([0, -5, 100.5, 101, 'abc', null])(
      'rechaza descuentoPct %p en un cliente con descuento',
      async (valor) => {
        expect(await errores(CreateClienteDto, { descuentoPct: valor })).toEqual(
          ['descuentoPct'],
        );
      },
    );

    it.each([1, 12.5, 100])('acepta descuentoPct %p', async (valor) => {
      expect(await errores(CreateClienteDto, { descuentoPct: valor })).toEqual(
        [],
      );
    });

    it('en otros tipos de cliente no se exige ni se valida', async () => {
      for (const tipo of ['cliente_estandar', 'cliente_cuenta_casa']) {
        expect(
          await errores(CreateClienteDto, { tipo_cliente: tipo }),
        ).toEqual([]);
        expect(
          await errores(CreateClienteDto, {
            tipo_cliente: tipo,
            descuentoPct: 500,
          }),
        ).toEqual([]);
      }
    });

    it('el DTO de actualización hereda la regla cuando trae el tipo', async () => {
      expect(
        await errores(UpdateClienteDto, { descuentoPct: 0 }),
      ).toEqual(['descuentoPct']);
      expect(
        await errores(UpdateClienteDto, { descuentoPct: 10 }),
      ).toEqual([]);
      expect(await validate(plainToInstance(UpdateClienteDto, {}))).toEqual(
        [],
      );
    });
  });

  describe('create', () => {
    it('guarda el descuento de un cliente con descuento', async () => {
      const { servicio, coleccion } = crearServicio();

      await servicio.create(
        datosBase({ tipo_cliente: 'cliente_descuento', descuentoPct: 15 } as never),
      );

      expect(coleccion.docs[0]).toMatchObject({ descuentoPct: 15 });
    });

    it('en otro tipo de cliente se ignora el descuento enviado', async () => {
      const { servicio, coleccion } = crearServicio();

      await servicio.create(datosBase({ descuentoPct: 15 } as never));

      expect(coleccion.docs[0].descuentoPct).toBeUndefined();
    });

    it('un cliente con descuento sin descuentoPct válido se rechaza (400)', async () => {
      const { servicio, coleccion } = crearServicio();

      const error = await fallo(
        servicio.create(
          datosBase({ tipo_cliente: 'cliente_descuento' } as never),
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(/descuento/i);
      expect(coleccion.docs).toHaveLength(0);
    });
  });

  describe('update', () => {
    const descuento: Doc = {
      id_cliente: CI,
      tipoIdentidad: 'CI',
      tipo_cliente: 'cliente_descuento',
      descuentoPct: 10,
      nombre_cliente: 'Juan Pérez',
      telefono_cliente: '53456789',
    };
    const estandar: Doc = {
      ...descuento,
      tipo_cliente: 'cliente_estandar',
      descuentoPct: undefined,
    };

    it('cambia el porcentaje de un cliente con descuento', async () => {
      const { servicio, coleccion } = crearServicio([descuento]);

      await servicio.update(String(coleccion.docs[0]._id), {
        descuentoPct: 25,
      });

      expect(coleccion.docs[0].descuentoPct).toBe(25);
    });

    it('un porcentaje inválido se rechaza y no cambia nada', async () => {
      const { servicio, coleccion } = crearServicio([descuento]);

      const error = await fallo(
        servicio.update(String(coleccion.docs[0]._id), { descuentoPct: 0 }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(coleccion.docs[0].descuentoPct).toBe(10);
    });

    it('pasar a otro tipo de cliente borra el descuento', async () => {
      const { servicio, coleccion } = crearServicio([descuento]);

      await servicio.update(String(coleccion.docs[0]._id), {
        tipo_cliente: 'cliente_estandar',
      } as never);

      expect(coleccion.docs[0].tipo_cliente).toBe('cliente_estandar');
      expect(coleccion.docs[0].descuentoPct).toBeUndefined();
    });

    it('en un cliente que no es de descuento, el porcentaje enviado se ignora', async () => {
      const { servicio, coleccion } = crearServicio([estandar]);

      await servicio.update(String(coleccion.docs[0]._id), {
        descuentoPct: 30,
        nombre_cliente: 'Juan P.',
      });

      expect(coleccion.docs[0].nombre_cliente).toBe('Juan P.');
      expect(coleccion.docs[0].descuentoPct).toBeUndefined();
    });

    it('pasar a cliente con descuento exige un porcentaje', async () => {
      const { servicio, coleccion } = crearServicio([estandar]);
      const id = String(coleccion.docs[0]._id);

      const error = await fallo(
        servicio.update(id, { tipo_cliente: 'cliente_descuento' } as never),
      );
      await servicio.update(id, {
        tipo_cliente: 'cliente_descuento',
        descuentoPct: 20,
      } as never);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(coleccion.docs[0]).toMatchObject({
        tipo_cliente: 'cliente_descuento',
        descuentoPct: 20,
      });
    });

    it('cambiar solo el nombre sigue sin leer el cliente', async () => {
      const { servicio, coleccion, modelo } = crearServicio([descuento]);

      await servicio.update(String(coleccion.docs[0]._id), {
        nombre_cliente: 'Otro',
      });

      expect(modelo.findById).not.toHaveBeenCalled();
    });
  });
});
