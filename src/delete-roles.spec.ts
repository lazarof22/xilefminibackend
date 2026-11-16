import { RolesGuard } from './modules/auth/guards/roles.guard';
import { UsuarioRol } from './modules/auth/schemas/usuarios.schema';
import { ProductoController } from './modules/inventario/producto/producto.controller';
import { AlmacenController } from './modules/inventario/almacen/almacen.controller';
import { ProveedorController } from './modules/clientes y provedores/proveedor/proveedor.controller';
import { ClienteController } from './modules/clientes y provedores/cliente/cliente.controller';
import { CategoriaController } from './modules/nomencladores/categoria/categoria.controller';

/** Deleting master data is reserved to administrador and gerente. */
const GUARDS = '__guards__';
const ROLES = 'roles';

describe.each([
  ['ProductoController', ProductoController],
  ['AlmacenController', AlmacenController],
  ['ProveedorController', ProveedorController],
  ['ClienteController', ClienteController],
  ['CategoriaController', CategoriaController],
])('%s.remove', (_nombre, controlador) => {
  // Read only to inspect decorator metadata; never invoked.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const remove = (controlador.prototype as unknown as { remove: () => unknown })
    .remove;

  it('carries @Roles(administrador, gerente) and the RolesGuard', () => {
    expect(Reflect.getMetadata(ROLES, remove)).toEqual([
      UsuarioRol.ADMIN,
      UsuarioRol.GERENTE,
    ]);
    expect(Reflect.getMetadata(GUARDS, remove)).toContain(RolesGuard);
  });
});
