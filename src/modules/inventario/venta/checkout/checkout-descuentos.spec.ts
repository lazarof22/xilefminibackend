/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { HttpException } from '@nestjs/common';
import {
  claveNueva,
  crearEntorno,
  dtoCheckout,
  efectivo,
  silenciarLogs,
  type Entorno,
} from './checkout-entorno-spec';

/**
 * Discount policy of the checkout (design document §6.9, §7.1 and §6.8):
 *  - the MANUAL line discount is capped per role (administrator and manager
 *    100 %, every other role 0 %);
 *  - a "cliente con descuento" gets its fixed discount applied automatically
 *    to every line: effective % = max(manual %, client %). The role cap only
 *    limits what the cashier types, never the automatic client discount.
 *
 * [0] Arroz 100 · [1] Frijol 50. Without tax so the figures are the nets.
 */

async function error(promesa: Promise<unknown>): Promise<HttpException> {
  try {
    await promesa;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('Se esperaba un error y no lo hubo');
}

const cliente = (
  e: Entorno,
  tipo: string,
  descuentoPct?: number,
): string => {
  const doc = e.modelos.clientes.insertar({
    id_cliente: `${Math.floor(Math.random() * 1e11)}`.padStart(11, '1'),
    nombre_cliente: 'Cliente de prueba',
    tipo_cliente: tipo,
    tipoIdentidad: 'CI',
    telefono_cliente: '5300000',
    codigoPais: '+53',
    ...(descuentoPct !== undefined ? { descuentoPct } : {}),
  });
  return String(doc._id);
};

describe('checkout — descuento por rol y descuento de cliente', () => {
  let restaurar: () => void;

  beforeEach(() => {
    restaurar = silenciarLogs();
  });
  afterEach(() => restaurar());

  describe('descuento manual por rol (§6.9)', () => {
    it('un cajero con tope 0 % que pide 10 % recibe 403 sin tocar nada; con 0 % vende', async () => {
      const e = crearEntorno({ impuesto: 0 });

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(
            e,
            [{ i: 0, cantidad: 1, descuentoPct: 10 }],
            efectivo({ billete100: 1 }),
          ),
          claveNueva(),
          e.usuario('cajero'),
        ),
      );

      expect(fallo.getStatus()).toBe(403);
      expect(String((fallo.getResponse() as any).message)).toMatch(
        /hasta 0% de descuento/,
      );
      expect(e.stock(0)).toBe(10);
      expect(e.modelos.ventas.docs).toHaveLength(0);

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [{ i: 0, cantidad: 1, descuentoPct: 0 }],
          efectivo({ billete100: 1 }),
        ),
        claveNueva(),
        e.usuario('cajero'),
      );
      expect(respuesta.venta.total).toBe(100);
    });

    it.each(['administrador', 'gerente'])(
      'el %s puede descontar a mano hasta 100 %',
      async (rol) => {
        const e = crearEntorno({ impuesto: 0 });

        const { respuesta } = await e.checkout.ejecutar(
          dtoCheckout(
            e,
            [
              { i: 0, cantidad: 1, descuentoPct: 100 },
              { i: 1, cantidad: 1, descuentoPct: 50 },
            ],
            efectivo({ billete50: 1 }),
          ),
          claveNueva(),
          e.usuario(rol),
        );

        expect(respuesta.venta.total).toBe(25);
      },
    );

    it.each(['jefe', 'economico', 'facturador', 'empleado'])(
      'el rol %s tampoco puede descontar a mano',
      async (rol) => {
        const e = crearEntorno({ impuesto: 0 });

        const fallo = await error(
          e.checkout.ejecutar(
            dtoCheckout(
              e,
              [{ i: 0, cantidad: 1, descuentoPct: 1 }],
              efectivo({ billete100: 1 }),
            ),
            claveNueva(),
            e.usuario(rol),
          ),
        );

        expect(fallo.getStatus()).toBe(403);
      },
    );

    it('parametros devuelve el tope del rol: 0 para el cajero, 100 para el gerente', async () => {
      const e = crearEntorno({ impuesto: 0 });

      expect(await e.checkout.parametros(e.usuario('cajero'))).toMatchObject({
        descuentoMaximoPct: 0,
      });
      expect(await e.checkout.parametros(e.usuario('gerente'))).toMatchObject({
        descuentoMaximoPct: 100,
      });
      expect(
        await e.checkout.parametros(e.usuario('administrador')),
      ).toMatchObject({ descuentoMaximoPct: 100 });
    });
  });

  describe('descuento automático del cliente con descuento (§6.8)', () => {
    it('se aplica solo a cada línea, también a un cajero con tope 0 %', async () => {
      const e = crearEntorno({ impuesto: 0 });
      const clienteId = cliente(e, 'cliente_descuento', 20);

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [
            { i: 0, cantidad: 1 },
            { i: 1, cantidad: 2 },
          ],
          efectivo({ billete100: 2 }),
          { clienteId },
        ),
        claveNueva(),
        e.usuario('cajero'),
      );

      // Arroz 100 − 20 + Frijol 100 − 20.
      expect(respuesta.venta).toMatchObject({
        subtotal: 200,
        descuento: 40,
        total: 160,
      });
      expect(respuesta.venta.items.map((l) => l.descuentoPct)).toEqual([
        20, 20,
      ]);
      expect(respuesta.advertencias).toContain(
        'Se aplicó el descuento del cliente (20%)',
      );
      // Persisted with the effective %.
      expect(
        e.modelos.ventas.docs[0].productos.map((l: any) => l.descuentoPct),
      ).toEqual([20, 20]);
      expect(e.modelos.ventas.docs[0].descuento_total).toBe(40);
    });

    it('con descuento manual: gana el mayor de los dos, línea por línea', async () => {
      const e = crearEntorno({ impuesto: 0 });
      const clienteId = cliente(e, 'cliente_descuento', 20);

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [
            { i: 0, cantidad: 1, descuentoPct: 30 },
            { i: 1, cantidad: 1, descuentoPct: 10 },
          ],
          efectivo({ billete100: 1, billete50: 1 }),
          { clienteId },
        ),
        claveNueva(),
        e.usuario('gerente'),
      );

      expect(respuesta.venta.items.map((l) => l.descuentoPct)).toEqual([
        30, 20,
      ]);
      // 70 + 40
      expect(respuesta.venta.total).toBe(110);
    });

    it('el tope del rol solo limita lo que se escribe a mano', async () => {
      const e = crearEntorno({ impuesto: 0 });
      const clienteId = cliente(e, 'cliente_descuento', 20);

      const fallo = await error(
        e.checkout.ejecutar(
          dtoCheckout(
            e,
            [{ i: 0, cantidad: 1, descuentoPct: 10 }],
            efectivo({ billete100: 1 }),
            { clienteId },
          ),
          claveNueva(),
          e.usuario('cajero'),
        ),
      );

      expect(fallo.getStatus()).toBe(403);
      expect(e.modelos.ventas.docs).toHaveLength(0);
    });

    it('si el descuento manual gana en todas las líneas, no se avisa del descuento del cliente', async () => {
      const e = crearEntorno({ impuesto: 0 });
      const clienteId = cliente(e, 'cliente_descuento', 10);

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [{ i: 0, cantidad: 1, descuentoPct: 50 }],
          efectivo({ billete100: 1 }),
          { clienteId },
        ),
        claveNueva(),
        e.usuario('gerente'),
      );

      expect(respuesta.venta.total).toBe(50);
      expect(respuesta.advertencias).toEqual([]);
    });

    it.each(['cliente_estandar', 'cliente_cuenta_casa'])(
      'un cliente %s no cambia nada (aunque tenga un descuentoPct suelto)',
      async (tipo) => {
        const e = crearEntorno({ impuesto: 0 });
        const clienteId = cliente(e, tipo, 50);

        const { respuesta } = await e.checkout.ejecutar(
          dtoCheckout(
            e,
            [{ i: 0, cantidad: 1 }],
            efectivo({ billete100: 1 }),
            { clienteId },
          ),
          claveNueva(),
          e.usuario('cajero'),
        );

        expect(respuesta.venta.total).toBe(100);
        expect(respuesta.venta.items[0].descuentoPct).toBe(0);
        expect(respuesta.advertencias).toEqual([]);
      },
    );

    it('un cliente con descuento sin porcentaje guardado (dato antiguo) no descuenta', async () => {
      const e = crearEntorno({ impuesto: 0 });
      const clienteId = cliente(e, 'cliente_descuento');

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(
          e,
          [{ i: 0, cantidad: 1 }],
          efectivo({ billete100: 1 }),
          { clienteId },
        ),
        claveNueva(),
        e.usuario('cajero'),
      );

      expect(respuesta.venta.total).toBe(100);
      expect(respuesta.advertencias).toEqual([]);
    });

    it('sin cliente la venta no cambia', async () => {
      const e = crearEntorno({ impuesto: 0 });

      const { respuesta } = await e.checkout.ejecutar(
        dtoCheckout(e, [{ i: 0, cantidad: 1 }], efectivo({ billete100: 1 })),
        claveNueva(),
        e.usuario('cajero'),
      );

      expect(respuesta.venta.total).toBe(100);
      expect(respuesta.advertencias).toEqual([]);
    });
  });
});
