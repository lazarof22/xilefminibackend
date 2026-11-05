import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ReportePlusService } from './reporte_plus.service';
import {
  MetodoPagoReporte,
  OrigenReporte,
  ReportePlus,
} from './schema/reporte_plus.schema';
import { TurnoReportePlus } from './schema/turno_reporte_plus.schema';
import { Kardex, KardexTipo } from '../kardex/schema/kardex.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { TurnoCaja } from '../turno-caja/schema/turno-caja.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import { LineaTurnoArchivada } from './schema/linea-turno-archivada.schema';
import { Devolucion } from '../devolucion/schema/devolucion.schema';

const chain = <T>(valor: T) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'select', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn().mockResolvedValue(valor);
  return c;
};

const fila = (extra: Partial<Record<string, unknown>> = {}) => ({
  fecha: new Date('2026-10-18T10:00:00'),
  productoId: new Types.ObjectId(),
  cantidadVendida: 1,
  stockFinal: 9,
  metodoPago: MetodoPagoReporte.EFECTIVO,
  total: 100,
  referencia: 'v1',
  enKardex: false,
  ...extra,
});

describe('ReportePlusService', () => {
  let service: ReportePlusService;
  let reporte: Record<string, jest.Mock>;
  let turno: Record<string, jest.Mock>;
  let kardex: Record<string, jest.Mock>;
  let extraccion: Record<string, jest.Mock>;
  let turnoCaja: Record<string, jest.Mock>;
  let deposito: Record<string, jest.Mock>;
  let devolucion: Record<string, jest.Mock>;
  let archivadas: Record<string, jest.Mock>;
  let filas: ReturnType<typeof fila>[];

  beforeEach(async () => {
    filas = [];
    reporte = {
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      distinct: jest.fn().mockResolvedValue([]),
      find: jest.fn(() => chain(filas)),
    };
    turno = {
      create: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
      find: jest.fn(() => chain([])),
      findOne: jest.fn(() => chain(null)),
    };
    kardex = {
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
    };
    extraccion = { find: jest.fn(() => chain([{ monto: 30 }, { monto: 20 }])) };
    turnoCaja = { find: jest.fn(() => chain([])) };
    deposito = { find: jest.fn(() => chain([])) };
    devolucion = { find: jest.fn(() => chain([])) };
    archivadas = {
      insertMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ReportePlusService,
        { provide: getModelToken(ReportePlus.name), useValue: reporte },
        { provide: getModelToken(TurnoReportePlus.name), useValue: turno },
        { provide: getModelToken(Kardex.name), useValue: kardex },
        { provide: getModelToken(Extraccion.name), useValue: extraccion },
        { provide: getModelToken(TurnoCaja.name), useValue: turnoCaja },
        { provide: getModelToken(DepositoBancario.name), useValue: deposito },
        {
          provide: getModelToken(LineaTurnoArchivada.name),
          useValue: archivadas,
        },
        { provide: getModelToken(Devolucion.name), useValue: devolucion },
      ],
    }).compile();
    service = mod.get(ReportePlusService);
  });

  describe('resumen', () => {
    it('suma ventas, resta extracciones, cuenta pagos por transferencia y desglosa por método', async () => {
      filas = [
        fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 100.1 }),
        fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 0.2 }),
        fila({ metodoPago: MetodoPagoReporte.CREDITO, total: 50 }),
        // un mismo pago por transferencia con 2 productos cuenta 1
        fila({
          metodoPago: MetodoPagoReporte.TRANSFERENCIA,
          total: 40,
          referencia: 't1',
        }),
        fila({
          metodoPago: MetodoPagoReporte.TRANSFERENCIA,
          total: 10,
          referencia: 't1',
        }),
        fila({
          metodoPago: MetodoPagoReporte.TRANSFERENCIA,
          total: 5,
          referencia: 't2',
        }),
        fila({ metodoPago: MetodoPagoReporte.FACTURA, total: 200 }),
      ];

      const r = await service.resumen();

      expect(r.porMetodo).toEqual({
        efectivo: 100.3,
        credito: 50,
        transferencia: 55,
        factura: 200,
      });
      expect(r.totalVentas).toBe(405.3);
      expect(r.totalExtracciones).toBe(50);
      expect(r.saldoNeto).toBe(355.3);
      expect(r.cantidadTransferencias).toBe(2);
      expect(r.movimientos).toBe(7);
    });

    describe('efectivo esperado, cuentas por cobrar y cobros electrónicos por separado', () => {
      it('reporta las tres cifras por separado y por moneda', async () => {
        filas = [
          fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 300 }),
          fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 20, moneda: 'USD' }),
          fila({ metodoPago: MetodoPagoReporte.CREDITO, total: 500 }),
          fila({ metodoPago: MetodoPagoReporte.TRANSFERENCIA, total: 70 }),
          fila({ metodoPago: MetodoPagoReporte.FACTURA, total: 900 }),
        ];
        turnoCaja.find.mockImplementation(() =>
          chain([
            { fondoInicial: { CUP: 1000, USD: 50 } },
            { fondoInicial: { CUP: 200 } },
          ]),
        );
        extraccion.find.mockImplementation(() =>
          chain([{ monto: 100 }, { monto: 5, moneda: 'USD' }]),
        );
        deposito.find.mockImplementation(() => chain([{ monto: 200 }]));

        const r = await service.resumen();

        // CUP: 1000 + 200 + 300 - 100 - 200 ; USD: 50 + 20 - 5
        expect(r.efectivoEsperado).toEqual({ CUP: 1200, USD: 65 });
        expect(r.cuentasPorCobrar).toEqual({ CUP: 500, USD: 0 });
        expect(r.cobrosElectronicos).toEqual({ CUP: 70, USD: 0 });
        expect(r.facturado).toEqual({ CUP: 900, USD: 0 });
        expect(r.detalleEfectivo.CUP).toMatchObject({
          fondoInicial: 1200,
          efectivoRecibido: 300,
          extracciones: 100,
          depositosBancarios: 200,
        });
      });

      it('descuenta del efectivo esperado las devoluciones en efectivo registradas', async () => {
        filas = [fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 300 })];
        devolucion.find.mockImplementation(() =>
          chain([{ montoDevuelto: 50, moneda: 'CUP' }]),
        );

        const r = await service.resumen();

        expect(devolucion.find).toHaveBeenCalledWith(
          expect.objectContaining({
            formaDevolucionDinero: 'efectivo',
            estado: 'registrada',
          }),
        );
        // 300 de ventas - 50 de extracciones (mock por defecto) - 50 devueltos
        expect(r.efectivoEsperado.CUP).toBe(200);
      });

      describe('movimientos de turnos de caja ya cerrados', () => {
        const ABIERTO = new Types.ObjectId();
        const CERRADO = new Types.ObjectId();

        it('sin ventas y con el turno cerrado, el efectivo esperado NO es negativo (regresión: -600 CUP)', async () => {
          filas = [];
          // El único turno ya se cerró: no hay fondo abierto, pero sus
          // extracciones y su depósito siguen dentro de la ventana de tiempo.
          turnoCaja.find.mockImplementation(() => chain([]));
          extraccion.find.mockImplementation(() =>
            chain([{ monto: 100, turnoCaja: CERRADO }]),
          );
          deposito.find.mockImplementation(() =>
            chain([{ monto: 500, turnoCajaId: CERRADO }]),
          );

          const r = await service.resumen();

          expect(r.efectivoEsperado.CUP).toBe(0);
          expect(r.detalleEfectivo.CUP).toMatchObject({
            fondoInicial: 0,
            extracciones: 0,
            depositosBancarios: 0,
          });
        });

        it('solo cuentan extracciones y depósitos de turnos ABIERTOS (el fondo es el de esos turnos)', async () => {
          filas = [fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 300 })];
          turnoCaja.find.mockImplementation(() =>
            chain([{ _id: ABIERTO, fondoInicial: { CUP: 1000 } }]),
          );
          extraccion.find.mockImplementation(() =>
            chain([
              { monto: 100, turnoCaja: ABIERTO },
              { monto: 400, turnoCaja: CERRADO },
            ]),
          );
          deposito.find.mockImplementation(() =>
            chain([
              { monto: 200, turnoCajaId: ABIERTO },
              { monto: 700, turnoCajaId: CERRADO },
            ]),
          );

          const r = await service.resumen();

          // 1000 + 300 - 100 - 200
          expect(r.efectivoEsperado.CUP).toBe(1000);
          expect(r.detalleEfectivo.CUP).toMatchObject({
            fondoInicial: 1000,
            extracciones: 100,
            depositosBancarios: 200,
          });
        });

        it('una extracción sin turno (anterior a los turnos) sigue contando por la ventana de tiempo', async () => {
          filas = [fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 300 })];
          extraccion.find.mockImplementation(() =>
            chain([{ monto: 100 }, { monto: 40, turnoCaja: CERRADO }]),
          );

          const r = await service.resumen();

          expect(r.efectivoEsperado.CUP).toBe(200); // 300 - 100
        });

        it('lee el turno de cada extracción y de cada depósito', async () => {
          const ext = chain([]);
          const dep = chain([]);
          extraccion.find.mockImplementation(() => ext);
          deposito.find.mockImplementation(() => dep);

          await service.resumen();

          expect(ext.select).toHaveBeenCalledWith('monto moneda turnoCaja');
          expect(dep.select).toHaveBeenCalledWith('monto moneda turnoCajaId');
        });

        it('no cambia los campos antiguos: totalExtracciones sigue sumando la ventana completa', async () => {
          extraccion.find.mockImplementation(() =>
            chain([{ monto: 100, turnoCaja: CERRADO }]),
          );

          const r = await service.resumen();

          expect(r.totalExtracciones).toBe(100);
        });
      });

      it('una venta a crédito, una transferencia o una factura no alteran el efectivo esperado', async () => {
        filas = [fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 50 })];
        const sin = await service.resumen();
        filas = [
          fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 50 }),
          fila({ metodoPago: MetodoPagoReporte.CREDITO, total: 400 }),
          fila({ metodoPago: MetodoPagoReporte.TRANSFERENCIA, total: 60 }),
          fila({ metodoPago: MetodoPagoReporte.FACTURA, total: 70 }),
        ];
        const con = await service.resumen();
        expect(con.efectivoEsperado).toEqual(sin.efectivoEsperado);
        expect(con.cuentasPorCobrar.CUP).toBe(400);
      });

      it('una venta a cuenta casa (total 0) no es una extracción ni mueve ninguna cifra', async () => {
        filas = [fila({ metodoPago: MetodoPagoReporte.EFECTIVO, total: 0 })];
        const r = await service.resumen();
        expect(r.totalExtracciones).toBe(50); // solo las extracciones reales
        expect(r.efectivoEsperado.CUP).toBe(-50);
        expect(r.detalleEfectivo.CUP.efectivoRecibido).toBe(0);
      });

      it('consulta los depósitos desde el cierre del último turno', async () => {
        const cierre = new Date('2026-10-18T08:00:00');
        turno.findOne.mockImplementation(() => chain({ cierre }));
        await service.resumen();
        expect(deposito.find.mock.calls[0][0].fecha.$gte).toEqual(cierre);
        expect(turnoCaja.find).toHaveBeenCalledWith({ estado: 'abierto' });
      });

      it('mantiene los campos antiguos (obsoletos) para no romper al cliente actual', async () => {
        filas = [fila({ total: 100 })];
        const r = await service.resumen();
        expect(r.saldoNeto).toBe(50);
        expect(r.totalVentas).toBe(100);
      });
    });

    it('sin ventas todo es 0', async () => {
      extraccion.find.mockImplementation(() => chain([]));
      const r = await service.resumen();
      expect(r.totalVentas).toBe(0);
      expect(r.saldoNeto).toBe(0);
      expect(r.cantidadTransferencias).toBe(0);
    });

    it('las extracciones cuentan desde el cierre del último turno', async () => {
      const cierre = new Date('2026-10-18T08:00:00');
      turno.findOne.mockImplementation(() => chain({ cierre }));
      const r = await service.resumen();
      expect(r.desde).toEqual(cierre);
      expect(extraccion.find.mock.calls[0][0].fecha.$gte).toEqual(cierre);
    });
  });

  describe('cerrarTurno', () => {
    it('rechaza si no hay ventas y no toca Kardex ni historial', async () => {
      await expect(service.cerrarTurno()).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(kardex.insertMany).not.toHaveBeenCalled();
      expect(turno.create).not.toHaveBeenCalled();
      expect(reporte.deleteMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ turnoCierre: expect.anything() }),
      );
      expect(archivadas.insertMany).not.toHaveBeenCalled();
    });

    it('Kardex primero, historial después y borra al final; no duplica las filas de factura', async () => {
      filas = [
        fila(),
        fila({
          enKardex: true,
          metodoPago: MetodoPagoReporte.FACTURA,
          total: 80,
        }),
      ];
      reporte.updateMany.mockResolvedValue({ modifiedCount: 2 });
      reporte.deleteMany.mockResolvedValue({ deletedCount: 2 });
      const orden: string[] = [];
      kardex.insertMany.mockImplementation(async () => {
        orden.push('kardex');
      });
      turno.create.mockImplementation(async () => {
        orden.push('turno');
      });
      reporte.deleteMany.mockImplementation(async () => {
        orden.push('borrar');
        return { deletedCount: 2 };
      });

      const r = await service.cerrarTurno();

      expect(orden).toEqual(['kardex', 'turno', 'borrar']);
      const entradas = kardex.insertMany.mock.calls[0][0];
      expect(entradas).toHaveLength(1);
      expect(entradas[0]).toMatchObject({
        tipo: KardexTipo.VENTA,
        cantidad: 1,
        stock: 9,
      });
      expect(entradas[0].referencia).toMatch(/^RP-[0-9a-f]{24}$/);
      expect(turno.create.mock.calls[0][0]).toMatchObject({
        totalVentas: 180,
        totalExtracciones: 50,
        saldoNeto: 130,
        movimientos: 2,
      });
      expect(r).toMatchObject({ movimientosKardex: 1, filasEliminadas: 2 });
    });

    it('archiva las líneas del turno ANTES de borrar las filas abiertas y no pierde detalle', async () => {
      filas = [
        fila({ moneda: 'USD', producto: { codigo: 'P1', nombre: 'Café' } }),
        fila({ metodoPago: MetodoPagoReporte.CREDITO, total: 30 }),
      ];
      reporte.updateMany.mockResolvedValue({ modifiedCount: 2 });
      const orden: string[] = [];
      archivadas.insertMany.mockImplementation(async () => {
        orden.push('archivo');
      });
      reporte.deleteMany.mockImplementation(async () => {
        orden.push('borrar');
        return { deletedCount: 2 };
      });

      await service.cerrarTurno();

      expect(orden).toEqual(['archivo', 'borrar']);
      const [lineas] = archivadas.insertMany.mock.calls[0];
      expect(lineas).toHaveLength(2);
      const turnoId = turno.create.mock.calls[0][0]._id;
      for (const l of lineas) expect(l.turnoReportePlusId).toEqual(turnoId);
      expect(lineas[0]).toMatchObject({
        moneda: 'USD',
        producto: { codigo: 'P1', nombre: 'Café' },
        cantidadVendida: 1,
        total: 100,
        referencia: 'v1',
      });
    });

    it('si falla el archivo NO borra nada: deshace Kardex, historial y archivo parcial y libera las filas', async () => {
      filas = [fila()];
      reporte.updateMany.mockResolvedValue({ modifiedCount: 1 });
      archivadas.insertMany.mockRejectedValue(new Error('disco lleno'));

      await expect(service.cerrarTurno()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );

      expect(
        reporte.deleteMany.mock.calls.filter(([f]) => f.turnoCierre),
      ).toHaveLength(0);
      expect(kardex.deleteMany).toHaveBeenCalled();
      expect(turno.deleteOne).toHaveBeenCalled();
      expect(archivadas.deleteMany).toHaveBeenCalledWith({
        turnoReportePlusId: expect.any(Types.ObjectId),
      });
      expect(reporte.updateMany).toHaveBeenLastCalledWith(
        { turnoCierre: expect.any(Types.ObjectId) },
        { $unset: { turnoCierre: 1 } },
      );
    });

    it('guarda en el historial las cifras separadas del turno', async () => {
      filas = [
        fila({ total: 100 }),
        fila({ metodoPago: MetodoPagoReporte.CREDITO, total: 30 }),
      ];
      reporte.updateMany.mockResolvedValue({ modifiedCount: 2 });
      await service.cerrarTurno();
      expect(turno.create.mock.calls[0][0]).toMatchObject({
        efectivoEsperado: { CUP: -50 + 100 },
        cuentasPorCobrar: { CUP: 30 },
        cobrosElectronicos: { CUP: 0 },
      });
    });

    it('si falla el Kardex NO borra nada: deshace el Kardex y libera las filas', async () => {
      filas = [fila()];
      reporte.updateMany.mockResolvedValue({ modifiedCount: 1 });
      kardex.insertMany.mockRejectedValue(new Error('mongo caído'));

      await expect(service.cerrarTurno()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );

      expect(turno.create).not.toHaveBeenCalled();
      const borrados = reporte.deleteMany.mock.calls.filter(
        ([f]) => f.turnoCierre,
      );
      expect(borrados).toHaveLength(0);
      expect(kardex.deleteMany).toHaveBeenCalledWith({
        referencia: expect.stringMatching(/^RP-/),
      });
      expect(reporte.updateMany).toHaveBeenLastCalledWith(
        { turnoCierre: expect.any(Types.ObjectId) },
        { $unset: { turnoCierre: 1 } },
      );
    });

    it('si falla guardar el historial también compensa y conserva las ventas', async () => {
      filas = [fila()];
      reporte.updateMany.mockResolvedValue({ modifiedCount: 1 });
      turno.create.mockRejectedValue(new Error('x'));

      await expect(service.cerrarTurno()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(kardex.deleteMany).toHaveBeenCalled();
      expect(
        reporte.deleteMany.mock.calls.filter(([f]) => f.turnoCierre),
      ).toHaveLength(0);
    });

    it('si el borrado final falla, el cierre sigue siendo válido y el próximo lo limpia', async () => {
      filas = [fila()];
      reporte.updateMany.mockResolvedValue({ modifiedCount: 1 });
      reporte.deleteMany.mockRejectedValueOnce(new Error('x'));

      const r = await service.cerrarTurno();
      expect(r.filasEliminadas).toBe(0);

      // siguiente cierre: hay filas marcadas de un turno ya guardado
      const idViejo = new Types.ObjectId();
      reporte.distinct.mockResolvedValue([idViejo]);
      turno.find.mockImplementation(() => chain([{ _id: idViejo }]));
      reporte.updateMany.mockResolvedValue({ modifiedCount: 0 });
      reporte.deleteMany.mockResolvedValue({ deletedCount: 1 });
      await expect(service.cerrarTurno()).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(reporte.deleteMany).toHaveBeenLastCalledWith({
        turnoCierre: { $in: [idViejo] },
      });
    });
  });

  describe('registrarLineas / eliminarPorReferencia', () => {
    it('guarda una fila por línea con snapshot del producto', async () => {
      const id = new Types.ObjectId().toHexString();
      await service.registrarLineas([
        {
          productoId: id,
          codigo: 'P1',
          nombre: 'Café',
          cantidadVendida: 2,
          stockFinal: 8,
          metodoPago: MetodoPagoReporte.CREDITO,
          total: 10,
          descuento: 1,
          impuesto: 0.5,
          origen: OrigenReporte.VENTA,
          referencia: 'v',
          enKardex: false,
        },
      ]);
      expect(reporte.insertMany.mock.calls[0][0][0]).toMatchObject({
        producto: { codigo: 'P1', nombre: 'Café' },
        cantidadVendida: 2,
        enKardex: false,
        moneda: 'CUP',
      });
    });

    it('guarda la moneda cuando la línea la informa', async () => {
      await service.registrarLineas([
        {
          productoId: new Types.ObjectId().toHexString(),
          codigo: 'P1',
          nombre: 'Café',
          cantidadVendida: 1,
          stockFinal: 8,
          metodoPago: MetodoPagoReporte.EFECTIVO,
          total: 10,
          descuento: 0,
          impuesto: 0,
          origen: OrigenReporte.VENTA,
          referencia: 'v',
          enKardex: false,
          moneda: 'USD',
        },
      ]);
      expect(reporte.insertMany.mock.calls[0][0][0].moneda).toBe('USD');
    });

    it('solo quita filas abiertas del documento', async () => {
      reporte.deleteMany.mockResolvedValue({ deletedCount: 3 });
      expect(await service.eliminarPorReferencia('FAC-1')).toBe(3);
      expect(reporte.deleteMany).toHaveBeenCalledWith({
        turnoCierre: { $exists: false },
        referencia: 'FAC-1',
      });
    });
  });
});
