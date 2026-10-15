#!/usr/bin/env node
/**
 * Crea (o restablece) un usuario administrador directamente en MongoDB.
 *
 *   npm run crear-admin -- <nombre> <contraseña> [--limpiar-antiguos]
 *
 * - Lee MONGODB_URI del entorno o del archivo .env.
 * - Guarda la contraseña con bcrypt, igual que la API.
 * - Si el usuario ya existe, solo le cambia la contraseña y lo deja como administrador.
 * - --limpiar-antiguos borra los usuarios del esquema anterior (sin "nombre"),
 *   que ya no pueden iniciar sesión y estorban al índice único.
 *
 * Es la forma de crear el primer administrador en una instalación nueva
 * (la API no tiene registro público) o de recuperar el acceso.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

function leerEnv() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const archivo = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(archivo)) return undefined;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*MONGODB_URI\s*=\s*(.*?)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

const TODOS_LOS_MODULOS = [
  'dashboard', 'inventario', 'ventas', 'compras', 'tasas',
  'punto_venta', 'clientes', 'nomencladores', 'configuracion', 'licencia',
];

async function main() {
  const args = process.argv.slice(2);
  const limpiar = args.includes('--limpiar-antiguos');
  const [nombre, contraseña] = args.filter((a) => !a.startsWith('--'));

  if (!nombre || !contraseña) {
    console.error('Uso: npm run crear-admin -- <nombre> <contraseña> [--limpiar-antiguos]');
    process.exit(1);
  }
  if (contraseña.length < 6) {
    console.error('La contraseña debe tener al menos 6 caracteres.');
    process.exit(1);
  }
  const uri = leerEnv();
  if (!uri) {
    console.error('No se encontró MONGODB_URI (variable de entorno o archivo .env).');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('usuarios');

  // Índices únicos del esquema anterior.
  for (const idx of await col.indexes().catch(() => [])) {
    if (['correo_empleado_1', 'ci_empleado_1'].includes(idx.name)) {
      await col.dropIndex(idx.name);
      console.log(`Índice antiguo eliminado: ${idx.name}`);
    }
  }

  const antiguos = await col.countDocuments({ nombre: { $exists: false } });
  if (antiguos > 0) {
    if (!limpiar) {
      console.error(
        `Hay ${antiguos} usuario(s) del esquema anterior (sin "nombre"). ` +
          'Vuelva a ejecutar con --limpiar-antiguos para borrarlos.',
      );
      process.exit(1);
    }
    const r = await col.deleteMany({ nombre: { $exists: false } });
    console.log(`Usuarios antiguos eliminados: ${r.deletedCount}`);
  }

  // Mismo criterio que la API: sin distinguir mayúsculas.
  const collation = { locale: 'es', strength: 2 };
  const hash = await bcrypt.hash(contraseña, 10);
  const existente = await col.findOne({ nombre: nombre.trim() }, { collation });

  if (existente) {
    await col.updateOne(
      { _id: existente._id },
      { $set: { contraseña: hash, rol: 'administrador', modulos: TODOS_LOS_MODULOS, updatedAt: new Date() } },
    );
    console.log(`Usuario "${existente.nombre}" actualizado: ahora es administrador con la contraseña indicada.`);
  } else {
    const ahora = new Date();
    await col.insertOne({
      nombre: nombre.trim(),
      contraseña: hash,
      rol: 'administrador',
      modulos: TODOS_LOS_MODULOS,
      createdAt: ahora,
      updatedAt: ahora,
    });
    console.log(`Administrador "${nombre.trim()}" creado.`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
