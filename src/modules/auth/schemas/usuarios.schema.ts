import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UsuariosDocument = HydratedDocument<Usuarios>;

/** Ocupación del usuario. El administrador accede a todos los módulos. */
export enum UsuarioRol {
  ADMIN = 'administrador',
  EMPLEADO = 'empleado',
  JEFE = 'jefe',
  FACTURADOR = 'facturador',
  CAJERO = 'cajero',
  GERENTE = 'gerente',
  ECONOMICO = 'economico',
}

/**
 * Módulos de la aplicación a los que se puede dar acceso. Los valores
 * coinciden con las rutas del frontend (`/inventario`, `/punto_venta`, ...).
 */
export enum ModuloApp {
  DASHBOARD = 'dashboard',
  INVENTARIO = 'inventario',
  VENTAS = 'ventas',
  COMPRAS = 'compras',
  TASAS = 'tasas',
  PUNTO_VENTA = 'punto_venta',
  CLIENTES = 'clientes',
  NOMENCLADORES = 'nomencladores',
  CONFIGURACION = 'configuracion',
  LICENCIA = 'licencia',
}

export const TODOS_LOS_MODULOS: ModuloApp[] = Object.values(ModuloApp);

/**
 * Usuario del sistema (colección `usuarios`).
 *
 * - `nombre` es el nombre de inicio de sesión (único, sin distinguir mayúsculas).
 * - `contraseña` se guarda con bcrypt y nunca se devuelve en las consultas.
 * - `modulos` son los módulos habilitados. Para el administrador se ignora:
 *   siempre tiene acceso a todos (ver `modulosEfectivos`).
 */
@Schema({ collection: 'usuarios', timestamps: true })
export class Usuarios {
  @Prop({ required: true, trim: true })
  nombre!: string;

  @Prop({ required: true, select: false })
  contraseña!: string;

  @Prop({ required: true, enum: UsuarioRol, default: UsuarioRol.EMPLEADO })
  rol!: UsuarioRol;

  @Prop({ type: [String], enum: ModuloApp, default: [] })
  modulos!: ModuloApp[];
}

export const UsuariosSchema = SchemaFactory.createForClass(Usuarios);

/** Collation con la que se compara el nombre (ignora mayúsculas, distingue acentos). */
export const COLLATION_NOMBRE = { locale: 'es', strength: 2 } as const;

UsuariosSchema.index(
  { nombre: 1 },
  { unique: true, collation: COLLATION_NOMBRE },
);

/** Módulos que realmente puede usar un usuario. */
export function modulosEfectivos(usuario: {
  rol: string;
  modulos?: readonly string[];
}): ModuloApp[] {
  if (usuario.rol === UsuarioRol.ADMIN) return [...TODOS_LOS_MODULOS];
  const permitidos = new Set(usuario.modulos ?? []);
  return TODOS_LOS_MODULOS.filter((m) => permitidos.has(m));
}
