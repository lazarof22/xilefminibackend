import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { LocalStrategy } from './strategies/local.strategies';
import { JwtStrategy } from './strategies/jwt.strategies';
import { RolesGuard } from './guards/roles.guard';
import { JWT_SECRET } from './constants/constants';
import { LicenciaService } from '../licencia/licencia.service';
import { ModuloApp, UsuarioRol, Usuarios } from './schemas/usuarios.schema';

type Doc = Record<string, any>;

/** Modelo Mongoose en memoria: solo lo que usan AuthService y UsuariosService. */
function crearModeloFalso() {
  const docs: Doc[] = [];
  let seq = 0;
  const id = () => (++seq).toString(16).padStart(24, '0');

  const coincide = (d: Doc, f: Doc = {}) =>
    Object.entries(f).every(([k, v]) => {
      if (k === 'nombre' && typeof v === 'string')
        return String(d.nombre).toLowerCase() === v.toLowerCase();
      if (v && typeof v === 'object' && '$ne' in v)
        return String(d[k]) !== String(v.$ne);
      if (v && typeof v === 'object' && '$exists' in v)
        return (d[k] !== undefined) === v.$exists;
      return String(d[k]) === String(v);
    });

  const consulta = (resultado: () => unknown) => {
    const q: Doc = {};
    for (const m of ['collation', 'select', 'sort', 'lean']) q[m] = () => q;
    q.exec = () => Promise.resolve(resultado());
    return q;
  };

  // Como Mongoose: cada consulta devuelve un documento nuevo; `save` lo persiste.
  const envolver = (d: Doc): Doc =>
    Object.assign(d, {
      set: (k: string, v: unknown) => (d[k] = v),
      save: () => {
        const i = docs.findIndex((x) => x._id === d._id);
        docs[i] = { ...d };
        return Promise.resolve(d);
      },
    });
  const copia = (d: Doc | undefined) => (d ? envolver({ ...d }) : null);

  const modelo = {
    docs,
    collection: {
      indexes: () => Promise.resolve([]),
      dropIndex: () => Promise.resolve(),
    },
    find: () =>
      consulta(() =>
        [...docs].sort((a, b) => a.nombre.localeCompare(b.nombre)),
      ),
    findOne: (f: Doc) =>
      consulta(() => copia(docs.find((d) => coincide(d, f)))),
    findById: (i: string) =>
      consulta(() => copia(docs.find((d) => d._id === i))),
    countDocuments: (f: Doc) =>
      consulta(() => docs.filter((d) => coincide(d, f)).length),
    create: (d: Doc) => {
      const doc = { _id: id(), ...d };
      docs.push(doc);
      return Promise.resolve(copia(doc));
    },
    deleteOne: (f: Doc) =>
      consulta(() => {
        const i = docs.findIndex((d) => coincide(d, { _id: f._id }));
        if (i >= 0) docs.splice(i, 1);
        return {};
      }),
  };
  const sembrar = (d: Doc) => docs.push({ _id: id(), ...d });
  return { modelo, sembrar };
}

describe('Auth + Usuarios (HTTP)', () => {
  let app: INestApplication;
  let sembrar: (d: Doc) => void;
  let modelo: ReturnType<typeof crearModeloFalso>['modelo'];

  beforeAll(async () => {
    const falso = crearModeloFalso();
    modelo = falso.modelo;
    sembrar = falso.sembrar;
    const hash = bcrypt.hashSync('admin123', 4);
    sembrar({
      nombre: 'admin',
      contraseña: hash,
      rol: UsuarioRol.ADMIN,
      modulos: [],
    });
    sembrar({
      nombre: 'maria',
      contraseña: bcrypt.hashSync('maria123', 4),
      rol: UsuarioRol.CAJERO,
      modulos: [ModuloApp.PUNTO_VENTA],
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({ secret: JWT_SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
      ],
      controllers: [AuthController, UsuariosController],
      providers: [
        AuthService,
        UsuariosService,
        LocalStrategy,
        JwtStrategy,
        RolesGuard,
        { provide: getModelToken(Usuarios.name), useValue: modelo },
        {
          provide: LicenciaService,
          useValue: {
            crearUsuarioConCupo: (_e: unknown, ops: { crear: () => unknown }) =>
              ops.crear(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => app.close());

  const login = (nombre: string, contraseña: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ nombre, contraseña });

  // El login está limitado a 10 intentos por minuto: las pruebas reutilizan sesiones.
  const sesiones = new Map<string, { access_token: string; usuario: Doc }>();
  const sesion = async (nombre: string, contraseña: string) => {
    if (!sesiones.has(nombre)) {
      const r = await login(nombre, contraseña).expect(201);
      sesiones.set(nombre, r.body);
    }
    return sesiones.get(nombre)!;
  };

  it('login correcto devuelve token y usuario con sus módulos', async () => {
    const r = await login('maria', 'maria123').expect(201);
    expect(r.body.access_token).toEqual(expect.any(String));
    expect(r.body.usuario).toEqual(
      expect.objectContaining({
        nombre: 'maria',
        rol: 'cajero',
        modulos: ['punto_venta'],
      }),
    );
    expect(JSON.stringify(r.body)).not.toContain('contraseña');
  });

  it('el nombre no distingue mayúsculas', async () => {
    await login('ADMIN', 'admin123').expect(201);
  });

  it('login con credenciales malas → 401', async () => {
    await login('maria', 'mala').expect(401);
    await login('fantasma', 'x').expect(401);
  });

  it('el administrador recibe todos los módulos', async () => {
    const r = await sesion('admin', 'admin123');
    expect(r.usuario.modulos).toHaveLength(Object.values(ModuloApp).length);
  });

  it('GET /usuarios exige token y rol de administrador', async () => {
    await request(app.getHttpServer()).get('/usuarios').expect(401);
    const maria = (await sesion('maria', 'maria123')).access_token;
    await request(app.getHttpServer())
      .get('/usuarios')
      .set('Authorization', `Bearer ${maria}`)
      .expect(403);
    const admin = (await sesion('admin', 'admin123')).access_token;
    const r = await request(app.getHttpServer())
      .get('/usuarios')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(r.body.map((u: Doc) => u.nombre)).toEqual(['admin', 'maria']);
    expect(JSON.stringify(r.body)).not.toContain('contraseña');
  });

  it('el admin crea un usuario (con validación) y este puede entrar', async () => {
    const admin = (await sesion('admin', 'admin123')).access_token;
    const auth = { Authorization: `Bearer ${admin}` };

    await request(app.getHttpServer())
      .post('/usuarios')
      .set(auth)
      .send({ nombre: 'pepe', contraseña: '123', rol: 'cajero' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/usuarios')
      .set(auth)
      .send({ nombre: 'pepe', contraseña: 'pepe123', rol: 'inventado' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/usuarios')
      .set(auth)
      .send({
        nombre: 'pepe',
        contraseña: 'pepe123',
        rol: 'cajero',
        modulos: ['nope'],
      })
      .expect(400);

    const r = await request(app.getHttpServer())
      .post('/usuarios')
      .set(auth)
      .send({
        nombre: 'pepe',
        contraseña: 'pepe123',
        rol: 'cajero',
        modulos: ['ventas', 'compras'],
      })
      .expect(201);
    expect(r.body).toMatchObject({
      nombre: 'pepe',
      rol: 'cajero',
      modulos: ['ventas', 'compras'],
    });

    await request(app.getHttpServer())
      .post('/usuarios')
      .set(auth)
      .send({ nombre: 'PEPE', contraseña: 'pepe123', rol: 'cajero' })
      .expect(409);

    const entrada = await login('pepe', 'pepe123').expect(201);
    expect(entrada.body.usuario.modulos).toEqual(['ventas', 'compras']);
  });

  it('cambiar los módulos de un usuario surte efecto en su token ya emitido', async () => {
    const admin = (await sesion('admin', 'admin123')).access_token;
    const maria = await sesion('maria', 'maria123');
    await request(app.getHttpServer())
      .patch(`/usuarios/${maria.usuario.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ modulos: ['inventario'] })
      .expect(200);
    const perfil = await request(app.getHttpServer())
      .get('/auth/perfil')
      .set('Authorization', `Bearer ${maria.access_token}`)
      .expect(200);
    expect(perfil.body.modulos).toEqual(['inventario']);
  });

  it('un usuario eliminado pierde el acceso al instante', async () => {
    const admin = (await sesion('admin', 'admin123')).access_token;
    sembrar({
      nombre: 'temporal',
      contraseña: bcrypt.hashSync('temporal1', 4),
      rol: UsuarioRol.EMPLEADO,
      modulos: [],
    });
    const t = await sesion('temporal', 'temporal1');
    await request(app.getHttpServer())
      .delete(`/usuarios/${t.usuario.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/perfil')
      .set('Authorization', `Bearer ${t.access_token}`)
      .expect(401);
  });

  it('el administrador no puede eliminarse a sí mismo', async () => {
    const r = await sesion('admin', 'admin123');
    await request(app.getHttpServer())
      .delete(`/usuarios/${r.usuario.id}`)
      .set('Authorization', `Bearer ${r.access_token}`)
      .expect(400);
  });

  it('ya no existe el registro público', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({})
      .expect(404);
  });

  it('limita los intentos de login (anti fuerza bruta)', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 12; i++)
      estados.push((await login('admin', 'incorrecta')).status);
    expect(estados).toContain(429);
  });
});
