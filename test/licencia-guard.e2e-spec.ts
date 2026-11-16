import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import {
  arrancarApp,
  cliente,
  crearUsuario,
  describeE2E,
  type EntornoE2E,
} from './helpers/e2e-app';
import { buildCanonicalPayload } from '../src/modules/licencia/services/payload-builder';

/**
 * The license guard, for real: AppModule with its own signing key and the real global guard.
 * Without a valid license every authenticated business route answers 403 `licencia_invalida`;
 * login, the session and the license management itself keep working so it can be fixed.
 */
describeE2E('Licencia: guard global (AppModule real + MongoDB)', () => {
  const clave = crypto.generateKeyPairSync('ed25519');
  const claveRaw = Buffer.from(
    clave.publicKey.export({ format: 'jwk' }).x as string,
    'base64url',
  ).toString('base64');
  const carpeta = path.join(os.tmpdir(), `xilef-lic-e2e-${process.pid}`);

  let entorno: EntornoE2E;
  let http: ReturnType<typeof cliente>;
  let admin: string;
  let cajero: string;

  beforeAll(async () => {
    fs.mkdirSync(carpeta, { recursive: true });
    process.env.LICENSE_FILE_PATH = path.join(carpeta, 'license.lic');
    process.env.LICENSE_STATE_PATH = path.join(carpeta, 'license.state');
    entorno = await arrancarApp({ clavesDeLicencia: [claveRaw] });
    http = cliente(entorno.app);
    await crearUsuario(entorno.app, {
      nombre: 'admin-lic',
      contraseña: 'Admin12345',
      rol: 'administrador',
    });
    await crearUsuario(entorno.app, {
      nombre: 'cajero-lic',
      contraseña: 'Cajero12345',
      rol: 'cajero',
      modulos: ['punto_venta'],
    });
    admin = await http.login('admin-lic', 'Admin12345');
    cajero = await http.login('cajero-lic', 'Cajero12345');
  });

  afterAll(async () => {
    await entorno?.cerrar();
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  async function firmar(secuencia: number, revocada = false) {
    const solicitud = await http.get(
      '/licencia/solicitud?empresa_id=EMP-E2E',
      admin,
    );
    const ahora = Date.now();
    const payload = {
      activa: !revocada,
      emitida_en: new Date(ahora - 60_000).toISOString(),
      empresa_id: 'EMP-E2E',
      fecha_inicio: new Date(ahora - 86_400_000).toISOString(),
      fecha_vencimiento: new Date(ahora + 86_400_000 * 365).toISOString(),
      hardware_fingerprint: (solicitud.body as { hardware_fingerprint: string })
        .hardware_fingerprint,
      license_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      max_usuarios: 10,
      revocada,
      secuencia,
      tipo: 'suscripcion_anual',
    };
    return {
      version_firma: 3,
      payload,
      firma: crypto
        .sign(
          null,
          Buffer.from(buildCanonicalPayload(payload as never), 'utf8'),
          clave.privateKey,
        )
        .toString('hex'),
    };
  }

  describe('without a license', () => {
    it.each(['/producto', '/venta', '/cliente', '/kardex', '/usuarios'])(
      '%s: 403 licencia_invalida with a token',
      async (ruta) => {
        const res = await http.get(ruta, admin);
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({
          message: 'Licencia no válida',
          codigo: 'licencia_invalida',
        });
      },
    );

    it('the cashier is locked out too', async () => {
      expect((await http.get('/producto', cajero)).status).toBe(403);
    });

    it('without a token it is a plain 401, not a license error', async () => {
      expect((await http.get('/producto')).status).toBe(401);
    });

    it('login, session and license management stay reachable so the license can be installed', async () => {
      expect((await http.get('/auth/perfil', admin)).status).toBe(200);
      expect((await http.get('/licencia/estado', admin)).status).toBe(200);
      expect((await http.get('/licencia/public/estado')).status).toBe(200);
      expect(
        (await http.get('/licencia/solicitud?empresa_id=EMP-E2E', admin))
          .status,
      ).toBe(200);
    });
  });

  describe('license lifecycle', () => {
    it('a valid license opens the system at once (cache invalidated by the import)', async () => {
      const res = await http.post('/licencia/activar', await firmar(1), admin);
      expect(res.status).toBe(200);

      expect((await http.get('/producto', admin)).status).toBe(200);
      expect((await http.get('/producto', cajero)).status).toBe(200);
    });

    it('a revocation closes it at once', async () => {
      const res = await http.post(
        '/licencia/activar',
        await firmar(2, true),
        admin,
      );
      expect(res.status).toBe(200);

      const cerrado = await http.get('/producto', admin);
      expect(cerrado.status).toBe(403);
      expect(cerrado.body).toMatchObject({ codigo: 'licencia_invalida' });
      // ...and the admin can still renew it
      expect((await http.get('/auth/perfil', admin)).status).toBe(200);
    });

    it('a renewal reopens it', async () => {
      const res = await http.post('/licencia/activar', await firmar(3), admin);
      expect(res.status).toBe(200);
      expect((await http.get('/producto', admin)).status).toBe(200);
    });

    it('a license of another empresa cannot replace the install empresa', async () => {
      const otra = await firmar(4);
      otra.payload.empresa_id = 'EMP-OTRA';
      otra.payload.license_id = '11111111-2222-4333-8444-555555555555';
      otra.firma = crypto
        .sign(
          null,
          Buffer.from(buildCanonicalPayload(otra.payload as never), 'utf8'),
          clave.privateKey,
        )
        .toString('hex');

      const res = await http.post('/licencia/activar', otra, admin);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ codigo: 'empresa_no_coincide' });
    });
  });

  describe('request hardening', () => {
    it('a JSON body nested thousands of levels deep is a 400, not a 500', async () => {
      const res = await request(entorno.app.getHttpServer())
        .post('/licencia/activar')
        .set('Authorization', `Bearer ${admin}`)
        .set('Content-Type', 'application/json')
        .send('{"version_firma":' + '['.repeat(4000) + ']'.repeat(4000) + '}');

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/anidado/);
    });

    it('malformed JSON is a JSON 400 (not an HTML page)', async () => {
      const res = await request(entorno.app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"nombre": ');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ statusCode: 400 });
    });

    it.each(['bearer', 'Bearer  ', 'Bearer\t'])(
      'a sloppy Authorization scheme (%j) is a 401',
      async (esquema) => {
        const res = await request(entorno.app.getHttpServer())
          .get('/auth/perfil')
          .set('Authorization', `${esquema}${admin}`);
        expect(res.status).toBe(401);
      },
    );

    it('a non-text login field is a 401, not a 500', async () => {
      const res = await http.post('/auth/login', {
        nombre: 123,
        contraseña: 'x',
      });
      expect(res.status).toBe(401);
    });

    it('an empresa_id with control characters is rejected by the request', async () => {
      const res = await http.get(
        '/licencia/solicitud?empresa_id=EMP%0D%0AX-Inyectado:1',
        admin,
      );
      expect(res.status).toBe(400);
    });
  });
});
