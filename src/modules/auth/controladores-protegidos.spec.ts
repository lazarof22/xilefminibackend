import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { UsuarioRol } from './schemas/usuarios.schema';
import { VentaController } from '../inventario/venta/venta.controller';
import { PagoController } from '../inventario/pago/pago.controller';
import { ClienteController } from '../clientes y provedores/cliente/cliente.controller';
import { TasaController } from '../tasa/tasa.controller';

/**
 * Venta, pago, cliente y tasa nacieron sin autenticación. Todo handler debe
 * exigir sesión: a nivel de clase, o handler por handler.
 */
describe('controllers that used to be public now require a session', () => {
  const controladores = [
    VentaController,
    PagoController,
    ClienteController,
    TasaController,
  ];

  it.each(controladores.map((c) => [c.name, c] as const))(
    '%s: every route handler is behind JwtAuthGuard',
    (_nombre, controlador) => {
      const delClase = (Reflect.getMetadata(GUARDS_METADATA, controlador) ??
        []) as unknown[];
      const metodos = Object.getOwnPropertyNames(controlador.prototype).filter(
        (m) =>
          m !== 'constructor' &&
          Reflect.getMetadata('path', controlador.prototype[m]) !== undefined,
      );
      expect(metodos.length).toBeGreaterThan(0);
      for (const metodo of metodos) {
        const delMetodo = (Reflect.getMetadata(
          GUARDS_METADATA,
          controlador.prototype[metodo],
        ) ?? []) as unknown[];
        expect([...delClase, ...delMetodo]).toContain(JwtAuthGuard);
      }
    },
  );

  it('registering a sale without the checkout, editing it or deleting it is for admin and gerente only', () => {
    const roles = (metodo: keyof VentaController) =>
      Reflect.getMetadata('roles', VentaController.prototype[metodo]) as
        string[] | undefined;
    for (const metodo of ['create', 'update', 'remove'] as const) {
      expect(roles(metodo)).toEqual([UsuarioRol.ADMIN, UsuarioRol.GERENTE]);
    }
    expect(roles('checkout')).toBeUndefined();
  });
});
