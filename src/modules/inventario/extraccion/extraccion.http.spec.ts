import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Types } from 'mongoose';
import request from 'supertest';
import { ExtraccionController } from './extraccion.controller';
import { ExtraccionService } from './extraccion.service';
import { Extraccion } from './schema/extraccion.schema';
import { TurnoCaja } from '../turno-caja/schema/turno-caja.schema';
import { JwtStrategy } from '../../auth/strategies/jwt.strategies';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AutorizadorSupervisorService } from '../../auth/autorizador-supervisor.service';
import { JWT_SECRET } from '../../auth/constants/constants';
import { UsuarioRol, Usuarios } from '../../auth/schemas/usuarios.schema';

const MENSAJE_403 =
  'Solo un administrador o gerente puede autorizar una extracción de caja';

interface UsuarioFalso {
  _id: Types.ObjectId;
  nombre: string;
  rol: UsuarioRol;
  modulos: string[];
}

const usuario = (nombre: string, rol: UsuarioRol): UsuarioFalso => ({
  _id: new Types.ObjectId(),
  nombre,
  rol,
  modulos: [],
});

describe('Extracción de caja autorizada por supervisor (HTTP)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let guardados: Record<string, unknown>[];
  let eliminados: string[];
  let usuarios: UsuarioFalso[];

  const cajero = usuario('maria', UsuarioRol.CAJERO);
  const otroCajero = usuario('pedro', UsuarioRol.CAJERO);
  const gerente = usuario('gerente1', UsuarioRol.GERENTE);
  const admin = usuario('admin', UsuarioRol.ADMIN);
  const economico = usuario('eco', UsuarioRol.ECONOMICO);

  const tokenDe = (u: { _id: Types.ObjectId }, opciones = {}) =>
    jwt.sign({ sub: u._id.toHexString() }, { secret: JWT_SECRET, ...opciones });
  const cuerpo = { monto: 100, causa: 'Compra de insumos', moneda: 'CUP' };

  beforeAll(async () => {
    usuarios = [cajero, otroCajero, gerente, admin, economico];
    const consulta = <T>(valor: T) => {
      const q: Record<string, unknown> = {};
      for (const m of ['lean', 'select', 'sort']) q[m] = () => q;
      q.exec = () => Promise.resolve(valor);
      return q;
    };
    const modeloUsuarios = {
      findById: (id: string) =>
        consulta(usuarios.find((u) => u._id.toHexString() === id) ?? null),
    };
    const modeloExtraccion = Object.assign(
      jest.fn().mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        save: () => {
          guardados.push(data);
          return Promise.resolve(data);
        },
      })),
      {
        findByIdAndDelete: (id: string) => {
          eliminados.push(id);
          return consulta({ _id: id });
        },
      },
    );
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: JWT_SECRET })],
      controllers: [ExtraccionController],
      providers: [
        ExtraccionService,
        AutorizadorSupervisorService,
        JwtStrategy,
        RolesGuard,
        { provide: getModelToken(Usuarios.name), useValue: modeloUsuarios },
        { provide: getModelToken(Extraccion.name), useValue: modeloExtraccion },
        {
          provide: getModelToken(TurnoCaja.name),
          useValue: { findOne: () => consulta(null) },
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
    jwt = moduleRef.get(JwtService);
  });

  beforeEach(() => {
    guardados = [];
    eliminados = [];
  });

  afterAll(() => app.close());

  const post = (sesion: string | null, body: Record<string, unknown>) => {
    const r = request(app.getHttpServer()).post('/extraccion');
    return (sesion ? r.set('Authorization', `Bearer ${sesion}`) : r).send(body);
  };

  it('sin sesión responde 401', async () => {
    await post(null, cuerpo).expect(401);
    expect(guardados).toHaveLength(0);
  });

  it('un cajero solo no puede extraer: 403 y no se guarda nada', async () => {
    const res = await post(tokenDe(cajero), cuerpo).expect(403);
    expect((res.body as { message: string }).message).toBe(MENSAJE_403);
    expect(guardados).toHaveLength(0);
  });

  it('un cajero con el token válido de un gerente extrae: 201 y queda autorizadoPor', async () => {
    const res = await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: tokenDe(gerente),
    }).expect(201);
    expect(res.body).toMatchObject({
      autorizadoPor: {
        usuarioId: gerente._id.toHexString(),
        nombre: 'gerente1',
      },
    });
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({
      empleadoId: cajero._id,
      autorizadoPor: { usuarioId: gerente._id, nombre: 'gerente1' },
    });
  });

  it('nunca guarda ni devuelve el token del autorizador', async () => {
    const supervisor = tokenDe(admin);
    const res = await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: supervisor,
    }).expect(201);
    expect(JSON.stringify(guardados)).not.toContain(supervisor);
    expect(JSON.stringify(res.body)).not.toContain(supervisor);
  });

  it('un cajero con el token de otro cajero: 403', async () => {
    const res = await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: tokenDe(otroCajero),
    }).expect(403);
    expect((res.body as { message: string }).message).toBe(MENSAJE_403);
    expect(guardados).toHaveLength(0);
  });

  it('el token de un rol que no es administrador ni gerente (económico): 403', async () => {
    await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: tokenDe(economico),
    }).expect(403);
  });

  it('un token autorizador vencido: 403', async () => {
    await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: tokenDe(gerente, { expiresIn: -10 }),
    }).expect(403);
    expect(guardados).toHaveLength(0);
  });

  it('un token autorizador falsificado (otra clave) o basura: 403', async () => {
    await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: tokenDe(gerente, { secret: 'otra-clave' }),
    }).expect(403);
    await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: 'no.es.un-jwt',
    }).expect(403);
    expect(guardados).toHaveLength(0);
  });

  it('un token válido de un usuario que ya no existe: 403', async () => {
    await post(tokenDe(cajero), {
      ...cuerpo,
      tokenAutorizador: tokenDe({ _id: new Types.ObjectId() }),
    }).expect(403);
  });

  it('el administrador solo extrae: 201 y se autoriza a sí mismo', async () => {
    await post(tokenDe(admin), cuerpo).expect(201);
    expect(guardados[0]).toMatchObject({
      empleadoId: admin._id,
      autorizadoPor: { usuarioId: admin._id, nombre: 'admin' },
    });
  });

  it('el gerente solo extrae: 201', async () => {
    await post(tokenDe(gerente), cuerpo).expect(201);
    expect(guardados[0]).toMatchObject({
      autorizadoPor: { usuarioId: gerente._id },
    });
  });

  it('DELETE por un cajero: 403 y no se elimina', async () => {
    const id = new Types.ObjectId().toHexString();
    await request(app.getHttpServer())
      .delete(`/extraccion/${id}`)
      .set('Authorization', `Bearer ${tokenDe(cajero)}`)
      .expect(403);
    expect(eliminados).toHaveLength(0);
  });

  it.each([
    ['administrador', admin],
    ['gerente', gerente],
  ])('DELETE por un %s: 200', async (_rol, u) => {
    const id = new Types.ObjectId().toHexString();
    await request(app.getHttpServer())
      .delete(`/extraccion/${id}`)
      .set('Authorization', `Bearer ${tokenDe(u)}`)
      .expect(200);
    expect(eliminados).toEqual([id]);
  });
});
