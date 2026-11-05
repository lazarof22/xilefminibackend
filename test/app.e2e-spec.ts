import request from 'supertest';
import { arrancarApp, describeE2E, type EntornoE2E } from './helpers/e2e-app';

// Se ejecuta solo con MONGO_TEST_URI (ver test/README.md).
describeE2E('AppController (e2e)', () => {
  let entorno: EntornoE2E;

  beforeAll(async () => {
    entorno = await arrancarApp();
  });

  afterAll(async () => {
    await entorno?.cerrar();
  });

  it('/ (GET)', () => {
    return request(entorno.app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
