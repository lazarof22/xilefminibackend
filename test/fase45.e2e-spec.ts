import { Types } from 'mongoose';
import {
  arrancarApp,
  cliente,
  crearUsuario,
  describeE2E,
  type EntornoE2E,
} from './helpers/e2e-app';

/**
 * Fase 4/5 (normativa y caja) de punta a punta: el AppModule REAL, con los
 * mismos pipes y filtros que `main.ts`, contra una MongoDB descartable. Los
 * tests con mocks no detectaron que el backend no arrancaba, que todo ajuste
 * se rechazaba o que la recepción no se podía crear.
 *
 * Los tests son secuenciales: cada paso usa los ids de los anteriores.
 */
interface Doc {
  _id: string;
  [campo: string]: unknown;
}

const nuevoId = () => new Types.ObjectId().toHexString();

describeE2E('Fase 4/5 e2e (AppModule real + MongoDB)', () => {
  let entorno: EntornoE2E;
  let http: ReturnType<typeof cliente>;
  let admin: string;
  let cajero: string;
  let gerente: string;

  // Ids creados por los pasos.
  const ids: Record<string, string> = {};
  let numeroRecepcion = '';

  beforeAll(async () => {
    entorno = await arrancarApp();
    http = cliente(entorno.app);
    await crearUsuario(entorno.app, {
      nombre: 'admin-e2e',
      contraseña: 'Admin12345',
      rol: 'administrador',
    });
    await crearUsuario(entorno.app, {
      nombre: 'cajero-e2e',
      contraseña: 'Cajero12345',
      rol: 'cajero',
      modulos: ['punto_venta'],
    });
    await crearUsuario(entorno.app, {
      nombre: 'gerente-e2e',
      contraseña: 'Gerente12345',
      rol: 'gerente',
    });
    admin = await http.login('admin-e2e', 'Admin12345');
    cajero = await http.login('cajero-e2e', 'Cajero12345');
    gerente = await http.login('gerente-e2e', 'Gerente12345');
  });

  afterAll(async () => {
    await entorno?.cerrar();
  });

  describe('arranque', () => {
    it('inicializa la app y construye el documento Swagger', async () => {
      const res = await http.get('/docs-json');
      expect(res.status).toBe(200);
      const doc = res.body as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      expect(doc.openapi).toMatch(/^3\./);
      expect(Object.keys(doc.paths)).toEqual(
        expect.arrayContaining([
          '/recepcion',
          '/ajuste-inventario',
          '/turno-caja',
          '/arqueo-caja',
          '/configuracion-tributaria',
          '/devolucion',
        ]),
      );
    });

    it('login devuelve token y rol del usuario', async () => {
      const res = await http.post('/auth/login', {
        nombre: 'cajero-e2e',
        contraseña: 'Cajero12345',
      });
      expect(res.status).toBe(201);
      const cuerpo = res.body as { usuario: { rol: string } };
      expect(cuerpo.usuario.rol).toBe('cajero');
    });

    it('rechaza credenciales inválidas con 401', async () => {
      const res = await http.post('/auth/login', {
        nombre: 'cajero-e2e',
        contraseña: 'mal',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('guards', () => {
    it.each([
      '/almacen',
      '/producto',
      '/kardex',
      '/reporte-plus',
      '/recepcion',
    ])('%s: 401 sin token y 200 con token', async (ruta) => {
      expect((await http.get(ruta)).status).toBe(401);
      expect((await http.get(ruta, 'token-invalido')).status).toBe(401);
      expect((await http.get(ruta, admin)).status).toBe(200);
    });
  });

  describe('empresa', () => {
    it('GET /empresa devuelve un objeto de ajustes, no un arreglo; /empresas es otra ruta', async () => {
      const put = await http.put(
        '/empresa',
        { nombre: 'Empresa E2E', direccion: 'Calle 1' },
        admin,
      );
      expect(put.status).toBe(200);

      const sinCodigo = await http.get('/empresa');
      expect(sinCodigo.status).toBe(200);
      expect(Array.isArray(sinCodigo.body)).toBe(false);
      expect((sinCodigo.body as Doc).nombre).toBe('Empresa E2E');

      const lista = await http.get('/empresas', admin);
      expect(lista.status).toBe(200);
      expect(Array.isArray(lista.body)).toBe(true);
    });
  });

  describe('datos maestros', () => {
    it('crea proveedor, almacén, contenedor, categoría y estado', async () => {
      const proveedor = await http.post(
        '/proveedores',
        {
          codigo: 'PRV-1',
          nombre: 'Proveedor E2E',
          cuentaBancaria: '9200-1234',
          direccion: 'Calle 2',
          telefono: 55512345,
        },
        admin,
      );
      expect(proveedor.status).toBe(201);
      ids.proveedor = (proveedor.body as Doc)._id;

      const almacen = await http.post(
        '/almacen',
        {
          codigoAlmacen: 'ALM-E2E',
          nombreAlmacen: 'Almacén E2E',
          cantidadContenedores: 1,
          direccion: 'Nave 1',
        },
        admin,
      );
      expect(almacen.status).toBe(201);
      ids.almacen = (almacen.body as Doc)._id;

      const contenedor = await http.post(
        '/contenedor',
        {
          codigoContenedor: 'CON-E2E',
          nombreContenedor: 'Contenedor E2E',
          almacen: ids.almacen,
          seccion: 'A',
          estante: '1',
          casilla: '1',
        },
        admin,
      );
      expect(contenedor.status).toBe(201);
      ids.contenedor = (contenedor.body as Doc)._id;

      const categoria = await http.post(
        '/categoria',
        { nombre_categoria: 'Bebidas E2E' },
        admin,
      );
      expect(categoria.status).toBe(201);

      const estado = await http.post(
        '/estado',
        { estado: 'Activo E2E' },
        admin,
      );
      expect(estado.status).toBe(201);
    });

    it('crea el producto con sus referencias', async () => {
      const res = await http.post(
        '/producto',
        {
          codigo_producto: 'P-E2E-1',
          nombre_producto: 'Producto E2E',
          categoria_producto: 'Bebidas E2E',
          precio_compra: 5,
          precio_venta: 8,
          stock_inicial: 0,
          stock_minimo: 1,
          estado: 'Activo E2E',
          almacen: ids.almacen,
          contenedor: ids.contenedor,
          gravado: 'gravado',
        },
        admin,
      );
      expect(res.status).toBe(201);
      const producto = res.body as Doc;
      expect(producto.codigo_producto).toBe('P-E2E-1');
      expect(producto.gravado).toBe('gravado');
      ids.producto = producto._id;
    });
  });

  describe('recepción SC-2-04', () => {
    const cuerpoRecepcion = () => ({
      almacenReceptor: ids.almacen,
      proveedor: ids.proveedor,
      documentoOrigen: {
        tipo: 'factura',
        numero: 'F-100',
        fecha: '2026-11-01',
      },
      responsableComprobacion: 'Ana',
      lineas: [
        {
          producto: ids.producto,
          contenedor: ids.contenedor,
          cantidad: 10,
          costo_unitario: 5,
        },
      ],
    });

    it('sin código de la entidad en la empresa se rechaza con un mensaje claro', async () => {
      const res = await http.post('/recepcion', cuerpoRecepcion(), admin);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('código de la entidad');
    });

    it('PUT /empresa con codigo_entidad: GET /empresa devuelve el objeto con el código', async () => {
      const put = await http.put(
        '/empresa',
        {
          nombre: 'Empresa E2E',
          direccion: 'Calle 1',
          codigo_entidad: '1234567',
        },
        admin,
      );
      expect(put.status).toBe(200);

      const res = await http.get('/empresa');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(false);
      expect(res.body).toMatchObject({
        nombre: 'Empresa E2E',
        codigo_entidad: '1234567',
      });
    });

    // Regresión: con `target` ES2023 los opcionales no enviados llegan como `undefined`
    // y un PUT parcial borraba (o rechazaba por `nombre` requerido) los datos guardados.
    it('PUT /empresa parcial ({ codigo_entidad }) conserva el resto de los datos', async () => {
      const put = await http.put(
        '/empresa',
        { codigo_entidad: '7654321' },
        admin,
      );
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({
        nombre: 'Empresa E2E',
        direccion: 'Calle 1',
        codigo_entidad: '7654321',
      });
      // Los tests siguientes esperan el código original.
      const restaurado = await http.put(
        '/empresa',
        { codigo_entidad: '1234567' },
        admin,
      );
      expect(restaurado.status).toBe(200);
    });

    it('crea el borrador REC-… con el total calculado por el servidor', async () => {
      const res = await http.post(
        '/recepcion',
        { ...cuerpoRecepcion(), total: 999 },
        admin,
      );
      expect(res.status).toBe(400); // el total lo fija el servidor

      const ok = await http.post('/recepcion', cuerpoRecepcion(), admin);
      expect(ok.status).toBe(201);
      const rec = ok.body as Doc;
      expect(rec.estado).toBe('borrador');
      expect(rec.numeroConsecutivo).toMatch(/^REC-/);
      expect(rec.total).toBe(50);
      expect(rec.inventarioAplicado).toBeFalsy();
      expect(rec.entidadReceptora).toMatchObject({
        codigo: '1234567',
        nombre: 'Empresa E2E',
      });
      ids.recepcion = rec._id;
      numeroRecepcion = rec.numeroConsecutivo as string;

      // Un borrador no mueve inventario.
      const existencias = await http.get(
        `/existencias/producto/${ids.producto}`,
        admin,
      );
      expect(existencias.status).toBe(200);
      expect(existencias.body).toEqual([]);
    });

    it('registrar: aplica el stock una sola vez y un segundo registrar da 409', async () => {
      const res = await http.post(
        `/recepcion/${ids.recepcion}/registrar`,
        {},
        admin,
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        estado: 'registrada',
        inventarioAplicado: true,
        numeroConsecutivo: numeroRecepcion,
      });

      const segundo = await http.post(
        `/recepcion/${ids.recepcion}/registrar`,
        {},
        admin,
      );
      expect(segundo.status).toBe(409);

      const existencias = await http.get(
        `/existencias/producto/${ids.producto}`,
        admin,
      );
      const filas = existencias.body as { cantidad: number }[];
      expect(filas).toHaveLength(1);
      expect(filas[0].cantidad).toBe(10);

      const leida = await http.get(`/recepcion/${ids.recepcion}`, admin);
      expect(leida.status).toBe(200);
      expect(leida.body).toMatchObject({
        estado: 'registrada',
        inventarioAplicado: true,
      });
    });

    it('una recepción registrada ya no se puede modificar (409)', async () => {
      const res = await http.patch(
        `/recepcion/${ids.recepcion}`,
        { responsableComprobacion: 'Otro' },
        admin,
      );
      expect(res.status).toBe(409);
    });

    it('el Kardex trae la entrada con referencia REC-…, importeCUP y costoPromedio', async () => {
      const res = await http.get('/kardex', admin);
      expect(res.status).toBe(200);
      const filas = res.body as Doc[];
      const fila = filas.find((k) => k.referencia === numeroRecepcion);
      expect(fila).toBeDefined();
      expect(fila).toMatchObject({
        tipo: 'compra',
        cantidad: 10,
        importeCUP: 50,
        costoPromedio: 5,
      });
      expect((fila?.productoId as Doc)._id).toBe(ids.producto);
    });
  });

  describe('ajuste de inventario SC-2-16', () => {
    const linea = (ajuste: number, extra: object = {}) => ({
      producto: ids.producto,
      almacen: ids.almacen,
      contenedor: ids.contenedor,
      ajuste,
      ...extra,
    });
    const cuerpo = (lineas: object[], causa = 'Merma E2E') => ({
      causa,
      autorizadoPor: 'admin-e2e',
      firmadoPor: 'Ana',
      lineas,
    });
    // Fuente de verdad del saldo: `stock_inicial` del producto. `GET /existencias/…`
    // es una vista por ubicación que, mientras el inventario no esté unificado
    // (modo heredado), solo se sincroniza la primera vez que se consulta.
    const stock = async (): Promise<number> => {
      const res = await http.get(`/producto/${ids.producto}`, admin);
      expect(res.status).toBe(200);
      return (res.body as { stock_inicial: number }).stock_inicial;
    };

    it('crea la causa en el nomenclador', async () => {
      const res = await http.post(
        '/causa-disminucion',
        { nombre_causa: 'Merma E2E' },
        admin,
      );
      expect(res.status).toBe(201);
    });

    it('un ajuste negativo válido: 201, AJU-… y saldos calculados por el servidor', async () => {
      const res = await http.post(
        '/ajuste-inventario',
        cuerpo([linea(-3)]),
        admin,
      );
      expect(res.status).toBe(201);
      const ajuste = res.body as Doc & { lineas: Doc[] };
      expect(ajuste.numeroConsecutivo).toMatch(/^AJU-/);
      expect(ajuste).toMatchObject({
        causa: 'Merma E2E',
        autorizadoPor: 'admin-e2e',
      });
      expect(ajuste.lineas).toHaveLength(1);
      expect(ajuste.lineas[0]).toMatchObject({
        ajuste: -3,
        saldoAntes: 10,
        saldoDespues: 7,
      });
      expect(await stock()).toBe(7);

      const leido = await http.get(`/ajuste-inventario/${ajuste._id}`, admin);
      expect(leido.status).toBe(200);
      expect((leido.body as Doc).numeroConsecutivo).toBe(
        ajuste.numeroConsecutivo,
      );
    });

    it('un cuerpo que envía saldoAntes se rechaza con 400 y no mueve stock', async () => {
      const res = await http.post(
        '/ajuste-inventario',
        cuerpo([linea(-1, { saldoAntes: 7 })]),
        admin,
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('lo calcula el servidor');
      expect(await stock()).toBe(7);
    });

    it('un saldo resultante negativo se rechaza con 400 y el stock no cambia', async () => {
      const res = await http.post(
        '/ajuste-inventario',
        cuerpo([linea(-8)]),
        admin,
      );
      expect(res.status).toBe(400);
      expect(await stock()).toBe(7);
    });

    it('una disminución con causa fuera del nomenclador se rechaza con 400', async () => {
      const res = await http.post(
        '/ajuste-inventario',
        cuerpo([linea(-1)], 'Causa inventada'),
        admin,
      );
      expect(res.status).toBe(400);
      expect(await stock()).toBe(7);
    });

    it('el cajero no puede ajustar inventario (403)', async () => {
      const res = await http.post(
        '/ajuste-inventario',
        cuerpo([linea(-1)]),
        cajero,
      );
      expect(res.status).toBe(403);
      expect(await stock()).toBe(7);
    });
  });

  describe('caja: turno, depósito, arqueo y reporte plus', () => {
    it('el cajero abre un turno (201) y un segundo turno abierto da 409', async () => {
      const res = await http.post(
        '/turno-caja',
        { fondoInicial: { CUP: 1000 } },
        cajero,
      );
      expect(res.status).toBe(201);
      const turno = res.body as Doc;
      expect(turno).toMatchObject({
        estado: 'abierto',
        fondoInicial: { CUP: 1000 },
      });
      ids.turno = turno._id;

      const segundo = await http.post(
        '/turno-caja',
        { fondoInicial: { CUP: 500 } },
        cajero,
      );
      expect(segundo.status).toBe(409);
    });

    it('registra un depósito bancario del turno', async () => {
      const res = await http.post(
        '/deposito-bancario',
        {
          turnoCajaId: ids.turno,
          monto: 300,
          moneda: 'CUP',
          banco: 'BANDEC',
          referencia: 'B-1',
        },
        cajero,
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        monto: 300,
        moneda: 'CUP',
        banco: 'BANDEC',
      });
      ids.deposito = (res.body as Doc)._id;
    });

    it('el efectivo esperado del arqueo es fondo - depósito', async () => {
      const res = await http.get(`/arqueo-caja/esperado/${ids.turno}`, admin);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ efectivoEsperado: { CUP: 700 } });
    });

    it('el arqueo registra la diferencia por moneda; un segundo arqueo del turno da 409', async () => {
      const cuerpo = {
        turnoCajaId: ids.turno,
        responsableArqueo: 'Luis',
        responsableCustodia: 'Marta',
        efectivoContado: { CUP: { contado: 690 } },
        observaciones: 'Faltan 10',
        firmadoPor: 'Luis',
      };
      const res = await http.post('/arqueo-caja', cuerpo, admin);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        efectivoContado: { CUP: { esperado: 700, contado: 690 } },
        diferencia: { CUP: { monto: -10, estado: 'faltante' } },
      });

      const segundo = await http.post('/arqueo-caja', cuerpo, admin);
      expect(segundo.status).toBe(409);

      // El cajero no arquea (solo administrador, económico y gerente).
      expect((await http.post('/arqueo-caja', cuerpo, cajero)).status).toBe(
        403,
      );
    });

    describe('extracción de efectivo', () => {
      const extraccion = (extra: object = {}) => ({
        monto: 50,
        causa: 'Pago a proveedor',
        moneda: 'CUP',
        ...extra,
      });

      it('el cajero solo no puede extraer (403)', async () => {
        const res = await http.post('/extraccion', extraccion(), cajero);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).toContain('administrador o gerente');
      });

      const pedirAutorizacion = (
        sesion: string,
        nombre: string,
        contraseña: string,
      ) =>
        http.post('/extraccion/autorizacion', { nombre, contraseña }, sesion);

      it('un cajero o una contraseña errónea no emiten autorización (403)', async () => {
        for (const [nombre, clave] of [
          ['cajero-e2e', 'Cajero12345'],
          ['gerente-e2e', 'mala'],
        ]) {
          const res = await pedirAutorizacion(cajero, nombre, clave);
          expect(res.status).toBe(403);
        }
      });

      it('el token de SESIÓN del gerente no sirve como autorización (403)', async () => {
        const res = await http.post(
          '/extraccion',
          extraccion({ tokenAutorizador: gerente }),
          cajero,
        );
        expect(res.status).toBe(403);
      });

      it('el gerente autoriza con sus credenciales: 201, turno del cajero, y el token se usa una sola vez', async () => {
        const emitida = await pedirAutorizacion(
          cajero,
          'gerente-e2e',
          'Gerente12345',
        );
        expect(emitida.status).toBe(201);
        const { tokenAutorizador } = emitida.body as {
          tokenAutorizador: string;
        };

        // La autorización no es una sesión: no abre el resto de la API.
        expect((await http.get('/extraccion', tokenAutorizador)).status).toBe(
          401,
        );

        const res = await http.post(
          '/extraccion',
          extraccion({ tokenAutorizador }),
          cajero,
        );
        expect(res.status).toBe(201);
        const doc = res.body as Doc;
        expect(doc).toMatchObject({
          monto: 50,
          moneda: 'CUP',
          causa: 'Pago a proveedor',
          autorizadoPor: { nombre: 'gerente-e2e' },
        });
        expect(doc.tokenAutorizador).toBeUndefined();
        expect(String(doc.turnoCaja)).toBe(ids.turno);

        const reuso = await http.post(
          '/extraccion',
          extraccion({ tokenAutorizador }),
          cajero,
        );
        expect(reuso.status).toBe(403);
      });
    });

    it('cerrar el turno no deja el efectivo esperado del Reporte Plus en negativo', async () => {
      const cierre = await http.patch(
        `/turno-caja/${ids.turno}/cerrar`,
        { observaciones: 'fin' },
        cajero,
      );
      expect(cierre.status).toBe(200);
      expect(cierre.body).toMatchObject({ estado: 'cerrado' });

      const res = await http.get('/reporte-plus/resumen', admin);
      expect(res.status).toBe(200);
      const { efectivoEsperado } = res.body as {
        efectivoEsperado: Record<string, number> | number;
      };
      const importes =
        typeof efectivoEsperado === 'number'
          ? [efectivoEsperado]
          : Object.values(efectivoEsperado);
      for (const importe of importes) expect(importe).toBeGreaterThanOrEqual(0);
    });
  });

  describe('extracción sin turno abierto', () => {
    const importes = async (): Promise<number[]> => {
      const res = await http.get('/reporte-plus/resumen', admin);
      expect(res.status).toBe(200);
      const { efectivoEsperado } = res.body as {
        efectivoEsperado: Record<string, number> | number;
      };
      return typeof efectivoEsperado === 'number'
        ? [efectivoEsperado]
        : Object.values(efectivoEsperado);
    };

    it('sin turno abierto se rechaza con 409 y el efectivo esperado nunca queda en negativo', async () => {
      const antes = (await http.get('/extraccion', admin)).body as Doc[];

      const res = await http.post(
        '/extraccion',
        { monto: 20, causa: 'Gasto menor', moneda: 'CUP' },
        admin,
      );
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain('turno de caja abierto');

      const despues = (await http.get('/extraccion', admin)).body as Doc[];
      expect(despues).toHaveLength(antes.length);
      for (const importe of await importes()) {
        expect(importe).toBeGreaterThanOrEqual(0);
      }
    });

    it('con un turno abierto, el administrador solo extrae: 201 y se autoriza a sí mismo', async () => {
      const turno = await http.post(
        '/turno-caja',
        { fondoInicial: { CUP: 0 } },
        admin,
      );
      expect(turno.status).toBe(201);

      const res = await http.post(
        '/extraccion',
        { monto: 0.01, causa: 'Gasto menor', moneda: 'CUP' },
        admin,
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        autorizadoPor: { nombre: 'admin-e2e' },
      });
    });
  });

  describe('configuración tributaria', () => {
    it('PUT guarda la configuración, GET la devuelve y el historial conserva ambas versiones', async () => {
      const primera = await http.put(
        '/configuracion-tributaria',
        { impuestoVentasPct: 10, vigenteDesde: '2026-01-01' },
        admin,
      );
      expect(primera.status).toBe(200);

      const activa = await http.get('/configuracion-tributaria', admin);
      expect(activa.status).toBe(200);
      expect(activa.body).toMatchObject({ impuestoVentasPct: 10 });

      const segunda = await http.put(
        '/configuracion-tributaria',
        { impuestoVentasPct: 12, vigenteDesde: '2026-02-01' },
        admin,
      );
      expect(segunda.status).toBe(200);

      const historial = await http.get(
        '/configuracion-tributaria/historial',
        admin,
      );
      expect(historial.status).toBe(200);
      const versiones = (historial.body as { impuestoVentasPct: number }[])
        .map((v) => v.impuestoVentasPct)
        .sort((a, b) => a - b);
      expect(versiones).toEqual([10, 12]);

      const vigente = await http.get('/configuracion-tributaria', admin);
      expect(vigente.body).toMatchObject({ impuestoVentasPct: 12 });
    });

    it('el cajero puede leer pero no cambiar la configuración (403)', async () => {
      expect((await http.get('/configuracion-tributaria', cajero)).status).toBe(
        200,
      );
      const res = await http.put(
        '/configuracion-tributaria',
        { impuestoVentasPct: 99 },
        cajero,
      );
      expect(res.status).toBe(403);
    });

    it('rechaza un porcentaje fuera de rango (400)', async () => {
      const res = await http.put(
        '/configuracion-tributaria',
        { impuestoVentasPct: 150 },
        admin,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('devolución (solo lectura y validación: sin ventas)', () => {
    it('GET /devolucion responde 200 con la página vacía', async () => {
      const res = await http.get('/devolucion', admin);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ datos: [], total: 0 });
    });

    it('POST con un origen inexistente se rechaza con 404 y no crea nada', async () => {
      const res = await http.post(
        '/devolucion',
        {
          tipo: 'venta',
          origenTipo: 'venta',
          origenRef: nuevoId(),
          motivo: 'Producto dañado',
          lineas: [
            {
              producto: ids.producto,
              cantidadSolicitada: 1,
              cantidadEntregada: 1,
            },
          ],
          autorizadoPor: 'admin-e2e',
          recibidoPor: 'Ana',
          firma: 'Ana',
          formaDevolucionDinero: 'efectivo',
        },
        admin,
      );
      expect(res.status).toBe(404);
      expect((await http.get('/devolucion', admin)).body).toMatchObject({
        datos: [],
        total: 0,
      });
    });

    it('POST sin motivo se rechaza con 400', async () => {
      const res = await http.post(
        '/devolucion',
        { tipo: 'venta', origenTipo: 'venta', origenRef: nuevoId() },
        admin,
      );
      expect(res.status).toBe(400);
    });
  });
});
