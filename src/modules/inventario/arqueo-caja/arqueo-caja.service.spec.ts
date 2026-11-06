import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ArqueoCajaService } from './arqueo-caja.service';
import { ArqueoCaja } from './schema/arqueo-caja.schema';
import { TurnoCaja } from '../turno-caja/schema/turno-caja.schema';
import { ReportePlus } from '../reporte_plus/schema/reporte_plus.schema';
import { LineaTurnoArchivada } from '../reporte_plus/schema/linea-turno-archivada.schema';
import { Extraccion } from '../extraccion/schema/extraccion.schema';
import { DepositoBancario } from '../deposito-bancario/schema/deposito-bancario.schema';
import { Devolucion } from '../devolucion/schema/devolucion.schema';

const chain = <T>(valor: T) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'select', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn().mockResolvedValue(valor);
  return c;
};

describe('ArqueoCajaService', () => {
  let service: ArqueoCajaService;
  let arqueo: Record<string, jest.Mock>;
  let turno: Record<string, jest.Mock>;
  let reporte: Record<string, jest.Mock>;
  let archivadas: Record<string, jest.Mock>;
  let extraccion: Record<string, jest.Mock>;
  let deposito: Record<string, jest.Mock>;
  let devolucion: Record<string, jest.Mock>;
  const turnoId = new Types.ObjectId();
  const usuario = new Types.ObjectId().toHexString();

  const turnoCerrado = () => ({
    _id: turnoId,
    cajeroId: new Types.ObjectId(),
    cajeroNombre: 'Ana Pérez',
    fechaApertura: new Date('2026-11-02T08:00:00'),
    fechaCierre: new Date('2026-11-02T18:00:00'),
    fondoInicial: { CUP: 1000, USD: 50 },
    estado: 'cerrado',
  });

  const dtoBase = () => ({
    turnoCajaId: turnoId.toHexString(),
    responsableArqueo: 'Luis Gómez',
    responsableCustodia: 'Marta Ruiz',
    efectivoContado: {
      CUP: {
        contado: 990,
        denominaciones: { '500': 1, '100': 4, '50': 1, '20': 2 },
      },
      USD: { contado: 70 },
    },
    observaciones: 'Faltan 10 CUP',
    firmadoPor: 'Luis Gómez',
  });

  beforeEach(async () => {
    arqueo = {
      create: jest.fn(async (d: Record<string, unknown>) => ({
        toObject: () => ({ _id: new Types.ObjectId(), ...d }),
      })),
      find: jest.fn(() => chain([])),
      findById: jest.fn(() => chain(null)),
      findOne: jest.fn(() => chain(null)),
    };
    turno = {
      findById: jest.fn(() => chain(turnoCerrado())),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    reporte = {
      find: jest.fn(() =>
        chain([
          {
            fecha: new Date('2026-11-02T10:00:00'),
            metodoPago: 'efectivo',
            total: 300,
          },
          {
            fecha: new Date('2026-11-02T11:00:00'),
            metodoPago: 'efectivo',
            total: 20,
            moneda: 'USD',
          },
          {
            fecha: new Date('2026-11-02T12:00:00'),
            metodoPago: 'credito',
            total: 5000,
          },
          {
            fecha: new Date('2026-11-02T12:30:00'),
            metodoPago: 'transferencia',
            total: 80,
          },
        ]),
      ),
    };
    archivadas = { find: jest.fn(() => chain([])) };
    extraccion = { find: jest.fn(() => chain([{ monto: 100 }])) };
    deposito = { find: jest.fn(() => chain([{ monto: 200 }])) };
    devolucion = { find: jest.fn(() => chain([])) };

    const mod = await Test.createTestingModule({
      providers: [
        ArqueoCajaService,
        { provide: getModelToken(ArqueoCaja.name), useValue: arqueo },
        { provide: getModelToken(TurnoCaja.name), useValue: turno },
        { provide: getModelToken(ReportePlus.name), useValue: reporte },
        {
          provide: getModelToken(LineaTurnoArchivada.name),
          useValue: archivadas,
        },
        { provide: getModelToken(Extraccion.name), useValue: extraccion },
        { provide: getModelToken(DepositoBancario.name), useValue: deposito },
        { provide: getModelToken(Devolucion.name), useValue: devolucion },
      ],
    }).compile();
    service = mod.get(ArqueoCajaService);
  });

  describe('calcularEsperado', () => {
    it('fondo + efectivo recibido - extracciones - depósitos, por moneda; el crédito y la transferencia no entran', async () => {
      const r = await service.esperadoDelTurno(turnoId.toHexString());
      expect(r.efectivoEsperado).toEqual({ CUP: 1000, USD: 70 });
      // consultas: filas abiertas y archivadas dentro de la ventana del turno, extracciones y depósitos del turno
      expect(reporte.find.mock.calls[0][0]).toMatchObject({
        turnoCierre: { $exists: false },
        fecha: {
          $gte: new Date('2026-11-02T08:00:00'),
          $lte: new Date('2026-11-02T18:00:00'),
        },
      });
      expect(archivadas.find.mock.calls[0][0].fecha.$gte).toEqual(
        new Date('2026-11-02T08:00:00'),
      );
      expect(extraccion.find).toHaveBeenCalledWith({ turnoCaja: turnoId });
      expect(deposito.find).toHaveBeenCalledWith({ turnoCajaId: turnoId });
    });

    it('resta las devoluciones en efectivo registradas dentro de la ventana del turno', async () => {
      devolucion.find.mockImplementation(() =>
        chain([{ montoDevuelto: 100, moneda: 'CUP' }]),
      );

      const r = await service.esperadoDelTurno(turnoId.toHexString());

      expect(devolucion.find).toHaveBeenCalledWith({
        formaDevolucionDinero: 'efectivo',
        estado: 'registrada',
        $or: [
          { turnoCaja: turnoId },
          {
            turnoCaja: { $exists: false },
            fecha: {
              $gte: new Date('2026-11-02T08:00:00'),
              $lte: new Date('2026-11-02T18:00:00'),
            },
          },
        ],
      });
      // 1000 (esperado sin devoluciones) - 100; USD no cambia
      expect(r.efectivoEsperado).toEqual({ CUP: 900, USD: 70 });
    });

    it('incluye las líneas ya archivadas de un cierre de Reporte Plus', async () => {
      archivadas.find.mockImplementation(() =>
        chain([
          {
            fecha: new Date('2026-11-02T09:00:00'),
            metodoPago: 'efectivo',
            total: 100,
          },
        ]),
      );
      const r = await service.esperadoDelTurno(turnoId.toHexString());
      expect(r.efectivoEsperado.CUP).toBe(1100);
    });

    it('404 si el turno no existe', async () => {
      turno.findById.mockImplementation(() => chain(null));
      await expect(
        service.esperadoDelTurno(turnoId.toHexString()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listar', () => {
    it('un turnoCajaId inválido responde 400, no un error 500 de conversión', async () => {
      await expect(service.listar('no-es-un-id')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('crear', () => {
    it('guarda esperado, contado y diferencia POR MONEDA sin sumar monedas', async () => {
      const r = await service.crear(dtoBase(), usuario);

      expect(r.efectivoContado.CUP).toMatchObject({
        esperado: 1000,
        contado: 990,
      });
      expect(r.efectivoContado.USD).toMatchObject({
        esperado: 70,
        contado: 70,
      });
      expect(r.efectivoContado.CUP.denominaciones).toEqual({
        '500': 1,
        '100': 4,
        '50': 1,
        '20': 2,
      });
      expect(r.diferencia).toEqual({
        CUP: { monto: -10, estado: 'faltante' },
        USD: { monto: 0, estado: 'cuadrado' },
      });
      expect(r).toMatchObject({
        responsableArqueo: 'Luis Gómez',
        responsableCustodia: 'Marta Ruiz',
        observaciones: 'Faltan 10 CUP',
        firmadoPor: 'Luis Gómez',
        mismoResponsableQueCajero: false,
      });
      expect(arqueo.create.mock.calls[0][0].creadoPor).toEqual(
        new Types.ObjectId(usuario),
      );
    });

    it('un sobrante se marca como tal', async () => {
      const dto = dtoBase();
      dto.efectivoContado.CUP.contado = 1015.5;
      const r = await service.crear(dto, usuario);
      expect(r.diferencia.CUP).toEqual({ monto: 15.5, estado: 'sobrante' });
    });

    it('vincula el arqueo al turno', async () => {
      const r = await service.crear(dtoBase(), usuario);
      expect(turno.updateOne).toHaveBeenCalledWith(
        { _id: turnoId },
        { $set: { arqueo: r._id } },
      );
    });

    it('si solo falla el vínculo con el turno, el arqueo ya creado se devuelve (reintentar daría 409)', async () => {
      turno.updateOne.mockRejectedValueOnce(new Error('caída de red'));
      const r = await service.crear(dtoBase(), usuario);
      expect(r._id).toBeDefined();
    });

    it('no rechaza si cuenta el mismo cajero, pero lo marca', async () => {
      const dto = { ...dtoBase(), responsableArqueo: '  ana pérez ' };
      const r = await service.crear(dto, usuario);
      expect(r.mismoResponsableQueCajero).toBe(true);
      expect(arqueo.create).toHaveBeenCalled();
    });

    it('exige el contado de toda moneda con efectivo esperado', async () => {
      const dto = dtoBase();
      delete (dto.efectivoContado as Record<string, unknown>).USD;
      await expect(service.crear(dto, usuario)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(arqueo.create).not.toHaveBeenCalled();
    });

    it('rechaza contados negativos o no numéricos', async () => {
      const dto = dtoBase();
      dto.efectivoContado.CUP.contado = -1;
      await expect(service.crear(dto, usuario)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('un segundo arqueo del mismo turno es un conflicto', async () => {
      arqueo.findOne.mockImplementation(() =>
        chain({ _id: new Types.ObjectId() }),
      );
      await expect(service.crear(dtoBase(), usuario)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(arqueo.create).not.toHaveBeenCalled();
    });

    it('traduce la violación del índice único (carrera) a conflicto', async () => {
      arqueo.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );
      await expect(service.crear(dtoBase(), usuario)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
