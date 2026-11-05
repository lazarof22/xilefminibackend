import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configurarApp, configurarSwagger } from '../../src/app.setup';

/** Las suites e2e solo corren si se indica una base de pruebas. */
export const MONGO_TEST_URI = process.env.MONGO_TEST_URI;

/** `describe` normal con `MONGO_TEST_URI`; sin ella, la suite se omite. */
export const describeE2E: jest.Describe = MONGO_TEST_URI
  ? describe
  : describe.skip;

const REGEX_BD = /^(mongodb(?:\+srv)?:\/\/[^/?]+)\/?([^?]*)(\?.*)?$/;

/**
 * Valida `MONGO_TEST_URI` y devuelve la URI de una base descartable propia de
 * esta suite (`<nombre>_<aleatorio>`), que se borra al terminar. Nunca se usa
 * la base con el nombre exacto indicado, y se rechaza cualquier nombre que no
 * contenga `e2e` o `test`: así la suite no puede tocar datos reales.
 */
export function uriDeBaseDescartable(
  uri: string | undefined = MONGO_TEST_URI,
): {
  uri: string;
  nombre: string;
} {
  if (!uri) {
    throw new Error('Defina MONGO_TEST_URI para ejecutar las pruebas e2e');
  }
  const partes = REGEX_BD.exec(uri);
  const nombreBase = partes?.[2] ?? '';
  if (!partes || !nombreBase) {
    throw new Error(
      'MONGO_TEST_URI debe incluir el nombre de la base, p. ej. mongodb://127.0.0.1:27017/xilef_e2e',
    );
  }
  if (!/e2e|test/i.test(nombreBase)) {
    throw new Error(
      `Por seguridad, la base de MONGO_TEST_URI ("${nombreBase}") debe contener "e2e" o "test"`,
    );
  }
  const nombre = `${nombreBase}_${randomBytes(4).toString('hex')}`;
  return { uri: `${partes[1]}/${nombre}${partes[3] ?? ''}`, nombre };
}

// Falla al cargar la suite (no al ejecutar) si la URI es insegura.
if (MONGO_TEST_URI) uriDeBaseDescartable(MONGO_TEST_URI);

export interface EntornoE2E {
  app: INestApplication<App>;
  conexion: Connection;
  nombreBd: string;
  /** Cierra la app y borra la base descartable. */
  cerrar(): Promise<void>;
}

/**
 * Arranca el `AppModule` REAL contra MongoDB con la misma configuración global
 * que `main.ts` (`configurarApp`) más Swagger. Las variables de entorno se
 * fijan ANTES de importar el módulo porque `ConfigModule` y `constants.ts` las
 * leen al cargarse.
 */
export async function arrancarApp(): Promise<EntornoE2E> {
  const base = uriDeBaseDescartable();
  process.env.MONGODB_URI = base.uri;
  process.env.JWT_SECRET = 'secreto-e2e';
  process.env.NODE_ENV = 'test';

  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configurarApp(app);
  configurarSwagger(app);
  await app.init();

  const conexion = app.get<Connection>(getConnectionToken());
  return {
    app,
    conexion,
    nombreBd: base.nombre,
    async cerrar() {
      // Solo se borra la base descartable creada por esta suite.
      if (conexion.name === base.nombre) await conexion.dropDatabase();
      await app.close();
    },
  };
}

/** Crea un usuario directamente en la colección (como `scripts/crear-admin.js`). */
export async function crearUsuario(
  app: INestApplication<App>,
  datos: {
    nombre: string;
    contraseña: string;
    rol: string;
    modulos?: string[];
  },
): Promise<void> {
  const { Usuarios } =
    await import('../../src/modules/auth/schemas/usuarios.schema');
  const modelo = app.get<Model<unknown>>(getModelToken(Usuarios.name));
  await modelo.init();
  await modelo.create({
    nombre: datos.nombre,
    contraseña: bcrypt.hashSync(datos.contraseña, 10),
    rol: datos.rol,
    modulos: datos.modulos ?? [],
  });
}

/** Cliente HTTP en proceso (supertest) con atajos que llevan el token. */
export function cliente(app: INestApplication<App>) {
  const servidor = app.getHttpServer() as App;
  const con = (token?: string) => (req: request.Test) =>
    token ? req.set('Authorization', `Bearer ${token}`) : req;
  return {
    get: (ruta: string, token?: string) =>
      con(token)(request(servidor).get(ruta)),
    post: (ruta: string, cuerpo: object, token?: string) =>
      con(token)(request(servidor).post(ruta)).send(cuerpo),
    put: (ruta: string, cuerpo: object, token?: string) =>
      con(token)(request(servidor).put(ruta)).send(cuerpo),
    patch: (ruta: string, cuerpo: object, token?: string) =>
      con(token)(request(servidor).patch(ruta)).send(cuerpo),
    async login(nombre: string, contraseña: string): Promise<string> {
      const res = await request(servidor)
        .post('/auth/login')
        .send({ nombre, contraseña });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`Login de ${nombre} falló: ${res.status}`);
      }
      return (res.body as { access_token: string }).access_token;
    },
  };
}
