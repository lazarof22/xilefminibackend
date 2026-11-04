import 'reflect-metadata';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { UsuarioRol } from './schemas/usuarios.schema';
import { ReportePlusController } from '../inventario/reporte_plus/reporte_plus.controller';

/**
 * Controllers that must reject unauthenticated requests (S11). `venta`, `pago`,
 * `tasa` and `cliente` are intentionally absent: the phase 2/3 work still has
 * to send the token from the POS payment dialogs before they can be guarded.
 */
const CONTROLLERS_PROTEGIDOS: string[] = [
  '../compra/compra/compra.controller',
  '../contabilidad/comprobante/comprobante.controller',
  '../contabilidad/cuenta/cuenta.controller',
  '../finanzas/cuenta-pagar/cuenta-pagar.controller',
  '../inventario/almacen/almacen.controller',
  '../inventario/contenedor/contenedor.controller',
  '../inventario/cuadre_caja/cuadre_caja.controller',
  '../inventario/exitencia/existencia.controller',
  '../inventario/extraccion/extraccion.controller',
  '../inventario/ipv/ipv.controller',
  '../inventario/kardex/kardex.controller',
  '../inventario/producto/producto.controller',
  '../inventario/registro-compra/registro-compra.controller',
  '../inventario/reporte-inventario/reporte-inventario.controller',
  '../inventario/reporte_plus/reporte_plus.controller',
  '../inventario/transferencia/transferencia.controller',
  '../nomencladores/cargo_empleado/cargo_empleado.controller',
  '../nomencladores/categoria/categoria.controller',
  '../nomencladores/causa-disminucion/causa-disminucion.controller',
  '../nomencladores/ciudad/ciudad.controller',
  '../nomencladores/comprobante-tipo/comprobante-tipo.controller',
  '../nomencladores/departamento/departamento.controller',
  '../nomencladores/elemento-gasto/elemento-gasto.controller',
  '../nomencladores/estado/estado.controller',
  '../nomencladores/moneda/moneda.controller',
  '../nomencladores/naturaleza-cuenta/naturaleza-cuenta.controller',
  '../nomencladores/pais/pais.controller',
  '../clientes y provedores/empresa/empresa.controller',
  '../clientes y provedores/proveedor/proveedor.controller',
];

function claseControlador(ruta: string): new (...args: never[]) => unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const modulo = require(ruta) as Record<string, unknown>;
  const clase = Object.values(modulo).find(
    (valor) => typeof valor === 'function' && valor.name.endsWith('Controller'),
  );
  if (!clase) throw new Error(`No controller exported by ${ruta}`);
  return clase as new (...args: never[]) => unknown;
}

describe('controllers protegidos con JwtAuthGuard (S11)', () => {
  it.each(CONTROLLERS_PROTEGIDOS)('%s rejects unauthenticated requests', (ruta) => {
    const clase = claseControlador(ruta);
    const guards = (Reflect.getMetadata('__guards__', clase) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('cerrar-turno de Reporte Plus solo lo permite a cajero y administrador', () => {
    const guards = (Reflect.getMetadata('__guards__', ReportePlusController) ??
      []) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));

    const roles = Reflect.getMetadata(
      'roles',
      ReportePlusController.prototype.cerrarTurno,
    ) as string[];
    expect([...roles].sort()).toEqual(
      [UsuarioRol.CAJERO, UsuarioRol.ADMIN].sort(),
    );
  });
});
