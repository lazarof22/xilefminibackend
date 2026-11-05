/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Logger, UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FakeModel } from '../inventario/exitencia/fake-mongo-spec';
import { canonico, huellaDe } from './huella';
import {
  OperacionIdempotenteService,
  OperacionPerdidaError,
} from './operacion-idempotente.service';
import { EstadoOperacion } from './schema/operacion-idempotente.schema';

const datos = (extra: Partial<Record<string, string>> = {}) => ({
  clave: 'clave-0001',
  ambito: 'venta.checkout',
  huella: huellaDe({ a: 1 }),
  usuarioId: 'u1',
  ...extra,
});

function entorno() {
  const modelo = new FakeModel([], { unico: ['clave'] });
  const servicio = new OperacionIdempotenteService(modelo as never);
  servicio.esperaMaxMs = 300;
  servicio.intervaloMs = 5;
  return { modelo, servicio };
}

describe('huella del cuerpo', () => {
  it('no depende del orden de las propiedades', () => {
    expect(huellaDe({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      huellaDe({ b: { d: [1, 2], c: 2 }, a: 1 }),
    );
  });

  it('cambia si cambia cualquier valor o el orden de un arreglo', () => {
    const base = huellaDe({ items: [1, 2], pago: { tipo: 'efectivo' } });

    expect(huellaDe({ items: [1, 3], pago: { tipo: 'efectivo' } })).not.toBe(
      base,
    );
    expect(huellaDe({ items: [2, 1], pago: { tipo: 'efectivo' } })).not.toBe(
      base,
    );
    expect(huellaDe({ items: [1, 2], pago: { tipo: 'credito' } })).not.toBe(
      base,
    );
  });

  it('las propiedades undefined no cuentan (el cuerpo sin ellas es el mismo)', () => {
    expect(huellaDe({ a: 1, estimado: undefined })).toBe(huellaDe({ a: 1 }));
    expect(canonico({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('ObjectId y fechas se escriben como texto estable', () => {
    const id = new Types.ObjectId();
    const fecha = new Date('2026-01-02T03:04:05.000Z');

    expect(canonico({ id, fecha })).toBe(
      `{"fecha":"2026-01-02T03:04:05.000Z","id":"${id.toHexString()}"}`,
    );
  });
});

describe('OperacionIdempotenteService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('iniciar', () => {
    it('la primera vez crea la operación en proceso y es suya', async () => {
      const { modelo, servicio } = entorno();

      const r = await servicio.iniciar(datos());

      expect(r.tipo).toBe('nueva');
      expect(modelo.docs).toHaveLength(1);
      expect(modelo.docs[0]).toMatchObject({
        clave: 'clave-0001',
        estado: EstadoOperacion.EN_PROCESO,
        intentos: 1,
        recuperaciones: 0,
        confirmando: false,
        pasos: [],
      });
      expect(modelo.docs[0].propietario).toEqual(expect.any(String));
      expect(modelo.docs[0].vence.getTime()).toBeGreaterThan(Date.now());
    });

    it('la misma clave con los mismos datos devuelve la existente, sin crear otra', async () => {
      const { modelo, servicio } = entorno();
      await servicio.iniciar(datos());

      const r = await servicio.iniciar(datos());

      expect(r.tipo).toBe('existente');
      expect(r.operacion.estado).toBe(EstadoOperacion.EN_PROCESO);
      expect(modelo.docs).toHaveLength(1);
    });

    it.each([
      ['otro cuerpo', { huella: huellaDe({ a: 2 }) }],
      ['otro usuario', { usuarioId: 'u2' }],
      ['otro tipo de operación', { ambito: 'otra.cosa' }],
    ])('la misma clave con %s se rechaza (422)', async (_nombre, cambio) => {
      const { servicio } = entorno();
      await servicio.iniciar(datos());

      await expect(servicio.iniciar(datos(cambio))).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('dos peticiones simultáneas con la misma clave: solo una es la dueña', async () => {
      const { modelo, servicio } = entorno();

      const resultados = await Promise.all([
        servicio.iniciar(datos()),
        servicio.iniciar(datos()),
        servicio.iniciar(datos()),
      ]);

      expect(resultados.filter((r) => r.tipo === 'nueva')).toHaveLength(1);
      expect(resultados.filter((r) => r.tipo === 'existente')).toHaveLength(2);
      expect(modelo.docs).toHaveLength(1);
    });

    it('si falló y quedó todo deshecho, la misma clave la ejecuta otra vez (intento 2)', async () => {
      const { modelo, servicio } = entorno();
      const primera = await servicio.iniciar(datos());
      // El modelo en memoria devuelve el propio documento guardado: se anota
      // el dueño ahora, antes de que el reintento lo cambie.
      const propietarioAntes = primera.operacion.propietario;
      const op = servicio.manejador(primera.operacion);
      await servicio.registrarPlan(op, { version: 1 });
      await servicio.fallar(op, 400, { message: 'Stock insuficiente' });
      expect(modelo.docs[0].estado).toBe(EstadoOperacion.FALLIDA);

      const segunda = await servicio.iniciar(datos());

      expect(segunda.tipo).toBe('nueva');
      expect(segunda.operacion.intentos).toBe(2);
      expect(segunda.operacion.propietario).not.toBe(propietarioAntes);
      const doc = modelo.docs[0];
      expect(doc.estado).toBe(EstadoOperacion.EN_PROCESO);
      // Lo del intento anterior se limpia, pero el registro de pasos se conserva.
      expect(doc.plan).toBeUndefined();
      expect(doc.error).toBeUndefined();
      expect(doc.pasos.map((p: any) => `${p.paso}:${p.evento}`)).toEqual([
        'plan:registrado',
        'operacion:fallida',
        'operacion:reintento',
      ]);
      expect(doc.pasos.at(-1).intento).toBe(2);
    });

    it('varios reintentos simultáneos de una fallida: solo uno la reclama', async () => {
      const { servicio } = entorno();
      const primera = await servicio.iniciar(datos());
      await servicio.fallar(servicio.manejador(primera.operacion), 400, 'x');

      const resultados = await Promise.all([
        servicio.iniciar(datos()),
        servicio.iniciar(datos()),
        servicio.iniciar(datos()),
      ]);

      expect(resultados.filter((r) => r.tipo === 'nueva')).toHaveLength(1);
    });
  });

  describe('escritura del registro', () => {
    it('cada escritura renueva el arrendamiento', async () => {
      const { modelo, servicio } = entorno();
      const r = await servicio.iniciar(datos());
      modelo.docs[0].vence = new Date(Date.now() - 5000);

      await servicio.registrarPaso(
        servicio.manejador(r.operacion),
        'stock',
        'iniciado',
        {
          linea: 0,
        },
      );

      expect(modelo.docs[0].vence.getTime()).toBeGreaterThan(Date.now());
    });

    it('registrarPaso solo añade asientos (nunca edita los anteriores)', async () => {
      const { modelo, servicio } = entorno();
      const r = await servicio.iniciar(datos());
      const op = servicio.manejador(r.operacion);

      await servicio.registrarPaso(op, 'stock', 'iniciado', { linea: 0 });
      const antes = modelo.docs[0].pasos;
      await servicio.registrarPaso(op, 'stock', 'hecho', {
        linea: 0,
        datos: { stockFinal: 3 },
      });

      expect(modelo.docs[0].pasos).toHaveLength(2);
      expect(modelo.docs[0].pasos[0]).toBe(antes[0]);
      expect(modelo.docs[0].pasos[1]).toMatchObject({
        paso: 'stock',
        evento: 'hecho',
        linea: 0,
        intento: 1,
        datos: { stockFinal: 3 },
      });
    });

    it('si la recuperación tomó la operación, el dueño anterior ya no puede escribir', async () => {
      const { modelo, servicio } = entorno();
      const r = await servicio.iniciar(datos());
      const viejo = servicio.manejador(r.operacion);
      modelo.docs[0].vence = new Date(Date.now() - 1000);

      const [tomada] = await servicio.reclamarVencidas('venta.checkout');
      expect(tomada.propietario).not.toBe(viejo.propietario);

      await expect(
        servicio.registrarPaso(viejo, 'stock', 'hecho'),
      ).rejects.toThrow(OperacionPerdidaError);
      await expect(servicio.completar(viejo, { ok: true })).rejects.toThrow(
        OperacionPerdidaError,
      );
      // Y el nuevo dueño sí puede.
      await servicio.completar(servicio.manejador(tomada), { ok: true });
      expect(modelo.docs[0].estado).toBe(EstadoOperacion.COMPLETADA);
    });

    it('una vez completada, nadie vuelve a escribirla', async () => {
      const { servicio } = entorno();
      const r = await servicio.iniciar(datos());
      const op = servicio.manejador(r.operacion);
      await servicio.completar(op, { ok: true });

      await expect(servicio.registrarPaso(op, 'x', 'y')).rejects.toThrow(
        OperacionPerdidaError,
      );
      await expect(servicio.fallar(op, 500, 'x')).rejects.toThrow(
        OperacionPerdidaError,
      );
    });

    it('completar guarda la respuesta y un reintento la recibe', async () => {
      const { servicio } = entorno();
      const r = await servicio.iniciar(datos());
      await servicio.completar(
        servicio.manejador(r.operacion),
        { total: 363 },
        201,
      );

      const otra = await servicio.iniciar(datos());

      expect(otra.tipo).toBe('existente');
      expect(otra.operacion.estado).toBe(EstadoOperacion.COMPLETADA);
      expect(otra.operacion.respuesta).toEqual({ total: 363 });
      expect(otra.operacion.codigoHttp).toBe(201);
    });

    it('marcarConfirmando guarda la respuesta y activa el punto de no retorno', async () => {
      const { modelo, servicio } = entorno();
      const r = await servicio.iniciar(datos());

      await servicio.marcarConfirmando(servicio.manejador(r.operacion), {
        comprobante: 'V-000001',
      });

      expect(modelo.docs[0].confirmando).toBe(true);
      expect(modelo.docs[0].respuesta).toEqual({ comprobante: 'V-000001' });
      expect(modelo.docs[0].estado).toBe(EstadoOperacion.EN_PROCESO);
    });

    it('enviarARevision deja el motivo y cierra la operación', async () => {
      const { modelo, servicio } = entorno();
      const r = await servicio.iniciar(datos());
      const op = servicio.manejador(r.operacion);

      await servicio.enviarARevision(op, 'stock dudoso');

      expect(modelo.docs[0]).toMatchObject({
        estado: EstadoOperacion.REVISION,
        motivoRevision: 'stock dudoso',
      });
      await expect(servicio.registrarPaso(op, 'x', 'y')).rejects.toThrow(
        OperacionPerdidaError,
      );
    });
  });

  describe('reclamarVencidas (recuperación)', () => {
    it('toma solo las del tipo pedido, en proceso y con el arrendamiento vencido', async () => {
      const { modelo, servicio } = entorno();
      await servicio.iniciar(datos({ clave: 'vencida-001' }));
      await servicio.iniciar(datos({ clave: 'vigente-001' }));
      await servicio.iniciar(
        datos({ clave: 'ajena-0001', ambito: 'otra.cosa' }),
      );
      const hecha = await servicio.iniciar(datos({ clave: 'hecha-0001' }));
      await servicio.completar(servicio.manejador(hecha.operacion), {});

      const vencer = (clave: string) => {
        modelo.docs.find((d) => d.clave === clave)!.vence = new Date(
          Date.now() - 1000,
        );
      };
      vencer('vencida-001');
      vencer('ajena-0001');
      vencer('hecha-0001');

      const tomadas = await servicio.reclamarVencidas('venta.checkout');

      expect(tomadas.map((t) => t.clave)).toEqual(['vencida-001']);
      expect(tomadas[0].recuperaciones).toBe(1);
      expect(tomadas[0].vence.getTime()).toBeGreaterThan(Date.now());
      // Ya no está vencida: un segundo barrido no la vuelve a tomar.
      expect(await servicio.reclamarVencidas('venta.checkout')).toEqual([]);
    });

    it('respeta el máximo por barrido', async () => {
      const { modelo, servicio } = entorno();
      for (let i = 0; i < 5; i++) {
        await servicio.iniciar(datos({ clave: `vencida-00${i}` }));
      }
      modelo.docs.forEach((d) => (d.vence = new Date(Date.now() - 1000)));

      expect(await servicio.reclamarVencidas('venta.checkout', 2)).toHaveLength(
        2,
      );
      expect(
        await servicio.reclamarVencidas('venta.checkout', 10),
      ).toHaveLength(3);
    });
  });

  describe('esperarFin', () => {
    it('devuelve la operación en cuanto deja de estar en proceso', async () => {
      const { servicio } = entorno();
      const r = await servicio.iniciar(datos());
      const op = servicio.manejador(r.operacion);
      setTimeout(() => void servicio.completar(op, { ok: 1 }), 40);

      const fin = await servicio.esperarFin('clave-0001', 2000);

      expect(fin?.estado).toBe(EstadoOperacion.COMPLETADA);
    });

    it('si se agota la espera, devuelve la operación todavía en proceso', async () => {
      const { servicio } = entorno();
      await servicio.iniciar(datos());

      const fin = await servicio.esperarFin('clave-0001', 30);

      expect(fin?.estado).toBe(EstadoOperacion.EN_PROCESO);
    });
  });
});
