import { CuadreCajaSchema } from './modules/inventario/cuadre_caja/schema/cuadre_caja.schema';
import { CuentaPagarSchema } from './modules/finanzas/cuenta-pagar/schema/cuenta-pagar.schema';
import { Usuarios } from './modules/auth/schemas/usuarios.schema';
import { Proveedor } from './modules/clientes y provedores/proveedor/schema/proveedor.schema';
import { ElementoGasto } from './modules/nomencladores/elemento-gasto/schema/elemento-gasto.schema';

/**
 * A `ref` that names a model nobody registered makes `populate` fail with
 * MissingSchemaError (HTTP 500). The names must be the registered class names.
 */
const refDe = (schema: { path: (p: string) => unknown }, campo: string) =>
  (schema.path(campo) as { options: { ref?: string } }).options.ref;

describe('schema refs point at registered model names', () => {
  it('CuadreCaja.empleado → Usuarios', () => {
    expect(refDe(CuadreCajaSchema, 'empleado')).toBe(Usuarios.name);
  });

  it('CuentaPagar.proveedor → Proveedor and CuentaPagar.concepto → ElementoGasto', () => {
    expect(refDe(CuentaPagarSchema, 'proveedor')).toBe(Proveedor.name);
    expect(refDe(CuentaPagarSchema, 'concepto')).toBe(ElementoGasto.name);
  });
});
