/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { HttpException } from '@nestjs/common';
import {
  claveNueva,
  crearEntorno,
  dtoCheckout,
  silenciarLogs,
  type Entorno,
} from './checkout-entorno-spec';

/**
 * "Cuenta casa" hands the goods over without charging (design document §6.1:
 * the commercial condition belongs to the CLIENT). The checkout must refuse a
 * cashier who asks for it without a client of that type.
 */

async function error(promesa: Promise<unknown>): Promise<HttpException> {
  try {
    await promesa;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('Se esperaba un error y no lo hubo');
}

const cliente = (e: Entorno, tipo: string): string =>
  String(
    e.modelos.clientes.insertar({
      id_cliente: `${Math.floor(Math.random() * 1e11)}`.padStart(11, '1'),
      nombre_cliente: 'Cliente de prueba',
      tipo_cliente: tipo,
      tipoIdentidad: 'CI',
      telefono_cliente: '5300000',
      codigoPais: '+53',
    })._id,
  );

const casa = { tipo: 'efectivo', tipoCliente: 'cliente-cuenta-casa' };

describe('checkout — cuenta casa exige un cliente cuenta casa', () => {
  let restaurar: () => void;
  beforeEach(() => {
    restaurar = silenciarLogs();
  });
  afterEach(() => restaurar());

  it('sin cliente: 400 y el stock no se mueve', async () => {
    const e = crearEntorno();

    const fallo = await error(
      e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], casa),
        claveNueva(),
        e.usuario(),
      ),
    );

    expect(fallo.getStatus()).toBe(400);
    expect(JSON.stringify(fallo.getResponse())).toMatch(/cuenta casa/);
    expect(e.stock(0)).toBe(10);
    expect(e.modelos.reportes.docs).toHaveLength(0);
  });

  it.each(['cliente_estandar', 'cliente_descuento'])(
    'con un cliente %s: 400 y el stock no se mueve',
    async (tipo) => {
      const e = crearEntorno();
      const clienteId = cliente(e, tipo);

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(e, [{ i: 0, cantidad: 1 }], casa, { clienteId }),
          claveNueva(),
          e.usuario(),
        ),
      );

      expect(fallo.getStatus()).toBe(400);
      expect(e.stock(0)).toBe(10);
    },
  );

  it('con un cliente cuenta casa: entrega sin cobro', async () => {
    const e = crearEntorno();
    const clienteId = cliente(e, 'cliente_cuenta_casa');

    const { respuesta } = await e.checkout.ejecutar(
      dtoCheckout(e, [{ i: 0, cantidad: 1 }], casa, { clienteId }),
      claveNueva(),
      e.usuario(),
    );

    expect(respuesta.pago).toMatchObject({
      esCuentaCasa: true,
      montoRecibido: 0,
    });
    expect(e.stock(0)).toBe(9);
  });
});
