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

    const mod = await Test.createTestingModule({
      providers: [
        ReportePlusService,
        { provide: getModelToken(ReportePlus.name), useValue: reporte },
        { provide: getModelToken(TurnoReportePlus.name), useValue: turno },
        { provide: getModelToken(Kardex.name), useValue: kardex },
        { provide: getModelToken(Extraccion.name), useValue: extraccion },
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
      });
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
