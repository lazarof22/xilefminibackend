import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ReporteInventarioController } from './reporte-inventario.controller';
import { ReporteInventarioService } from './reporte-inventario.service';

describe('GET /inventario/reporte', () => {
  let app: INestApplication;
  const obtenerReporte = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReporteInventarioController],
      providers: [
        { provide: ReporteInventarioService, useValue: { obtenerReporte } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con la lista que arma el servicio', async () => {
    const filas = [
      {
        _id: '6abf0da4f4a95d02f5df6ef2',
        codigo_producto: 'A-1',
        nombre_producto: 'Televisor',
        productos_disponibles: 50,
        productos_reservados: 0,
        inventario_total: 50,
      },
    ];
    obtenerReporte.mockResolvedValue(filas);

    const res = await request(app.getHttpServer()).get('/inventario/reporte');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(filas);
  });

  it('con la base vacía responde 200 y []', async () => {
    obtenerReporte.mockResolvedValue([]);

    const res = await request(app.getHttpServer()).get('/inventario/reporte');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
