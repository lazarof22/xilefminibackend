import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { DepositoBancarioService } from './deposito-bancario.service';
import { DepositoBancario } from './schema/deposito-bancario.schema';
import { ConfiguracionDeposito } from './schema/configuracion-deposito.schema';
import { TurnoCaja } from '../turno-caja/schema/turno-caja.schema';

const chain = <T>(valor: T) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'select', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn().mockResolvedValue(valor);
  return c;
};

const d = (s: string) => new Date(`${s}T10:00:00`);

describe('DepositoBancarioService', () => {
  let service: DepositoBancarioService;
  let deposito: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let turno: Record<string, jest.Mock>;
  const turnoId = new Types.ObjectId();
  const usuario = new Types.ObjectId().toHexString();

  beforeEach(async () => {
    deposito = {
      create: jest.fn(async (x: Record<string, unknown>) => ({
        toObject: () => x,
      })),
      find: jest.fn(() => chain([])),
    };
    config = {
      findOne: jest.fn(() => chain(null)),
      findOneAndUpdate: jest.fn(() => chain({})),
    };
    turno = {
      findById: jest.fn(() => chain({ _id: turnoId })),
      find: jest.fn(() => chain([])),
    };
    const mod = await Test.createTestingModule({
      providers: [
        DepositoBancarioService,
        { provide: getModelToken(DepositoBancario.name), useValue: deposito },
        {
          provide: getModelToken(ConfiguracionDeposito.name),
          useValue: config,
        },
        { provide: getModelToken(TurnoCaja.name), useValue: turno },
      ],
    }).compile();
    service = mod.get(DepositoBancarioService);
  });

  describe('registrar', () => {
    it('guarda el depósito del turno con moneda CUP por defecto y el usuario', async () => {
      await service.registrar(
        {
          turnoCajaId: turnoId.toHexString(),
          monto: 500,
          banco: 'BPA',
          referencia: 'B-1',
        },
        usuario,
      );
      const doc = deposito.create.mock.calls[0][0];
      expect(doc).toMatchObject({
        monto: 500,
        moneda: 'CUP',
        banco: 'BPA',
        referencia: 'B-1',
      });
      expect(doc.turnoCajaId).toEqual(turnoId);
      expect(doc.registradoPor).toEqual(new Types.ObjectId(usuario));
      expect(doc.fecha).toBeInstanceOf(Date);
    });

    it('rechaza un turno inexistente y un monto no positivo', async () => {
      turno.findById.mockImplementation(() => chain(null));
      await expect(
        service.registrar(
          { turnoCajaId: turnoId.toHexString(), monto: 5, banco: 'x' },
          usuario,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      turno.findById.mockImplementation(() => chain({ _id: turnoId }));
      await expect(
        service.registrar(
          { turnoCajaId: turnoId.toHexString(), monto: 0, banco: 'x' },
          usuario,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(deposito.create).not.toHaveBeenCalled();
    });
  });

  describe('propiedad del turno y lecturas', () => {
    const yo = usuario;
    const dto = () => ({
      turnoCajaId: turnoId.toHexString(),
      monto: 10,
      banco: 'BPA',
    });

    it('un cajero no deposita sobre el turno de otro cajero (403) y no se guarda nada', async () => {
      turno.findById.mockImplementation(() =>
        chain({ _id: turnoId, cajeroId: new Types.ObjectId() }),
      );
      await expect(
        service.registrar(dto(), yo, 'cajero'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(deposito.create).not.toHaveBeenCalled();
    });

    it('un cajero deposita sobre su propio turno; un económico, sobre el de cualquiera', async () => {
      turno.findById.mockImplementation(() =>
        chain({ _id: turnoId, cajeroId: new Types.ObjectId(yo) }),
      );
      await service.registrar(dto(), yo, 'cajero');
      turno.findById.mockImplementation(() =>
        chain({ _id: turnoId, cajeroId: new Types.ObjectId() }),
      );
      await service.registrar(dto(), yo, 'economico');
      expect(deposito.create).toHaveBeenCalledTimes(2);
    });

    it('un cajero solo lista los depósitos que registró', async () => {
      await service.listar({}, { userId: yo, rol: 'cajero' });
      expect(deposito.find).toHaveBeenCalledWith({
        registradoPor: new Types.ObjectId(yo),
      });
      deposito.find.mockClear();
      await service.listar({}, { userId: yo, rol: 'gerente' });
      expect(deposito.find).toHaveBeenCalledWith({});
    });
  });

  describe('configuración', () => {
    it('por defecto las alertas están apagadas con plazo 1 y máximo 5', async () => {
      expect(await service.obtenerConfiguracion()).toEqual({
        alertasActivas: false,
        plazoDiasHabiles: 1,
        maxDiasEntreDepositos: 5,
      });
    });

    it('actualizar hace upsert del único documento', async () => {
      config.findOneAndUpdate.mockImplementation(() =>
        chain({
          alertasActivas: true,
          plazoDiasHabiles: 2,
          maxDiasEntreDepositos: 5,
        }),
      );
      const r = await service.actualizarConfiguracion({
        alertasActivas: true,
        plazoDiasHabiles: 2,
      });
      const [filtro, cambio, opciones] = config.findOneAndUpdate.mock.calls[0];
      expect(filtro).toEqual({ clave: 'deposito' });
      expect(cambio.$set).toEqual({
        alertasActivas: true,
        plazoDiasHabiles: 2,
      });
      expect(opciones).toMatchObject({ upsert: true, new: true });
      expect(r.alertasActivas).toBe(true);
    });
  });

  describe('alertas', () => {
    it('con el flag apagado responde { activas: false, alertas: [] } sin consultar turnos', async () => {
      expect(await service.alertas(d('2026-11-20'))).toEqual({
        activas: false,
        alertas: [],
      });
      expect(turno.find).not.toHaveBeenCalled();
      expect(deposito.find).not.toHaveBeenCalled();
    });

    describe('con el flag encendido', () => {
      const t1 = new Types.ObjectId();
      beforeEach(() => {
        config.findOne.mockImplementation(() =>
          chain({
            alertasActivas: true,
            plazoDiasHabiles: 1,
            maxDiasEntreDepositos: 5,
          }),
        );
      });

      it('avisa un turno cerrado sin depósito pasado el plazo en días hábiles', async () => {
        // cerrado el viernes 6; plazo 1 día hábil -> lunes 9
        turno.find.mockImplementation(() =>
          chain([
            {
              _id: t1,
              fechaApertura: d('2026-11-06'),
              fechaCierre: d('2026-11-06'),
            },
          ]),
        );
        const r = await service.alertas(d('2026-11-10'));
        expect(r.activas).toBe(true);
        const a = r.alertas.find((x) => x.tipo === 'turno_sin_deposito');
        expect(a).toMatchObject({ turnoCajaId: t1 });
        expect(a?.fechaLimite?.getDate()).toBe(9);
      });

      it('no avisa dentro del plazo ni si el turno ya tiene depósito', async () => {
        turno.find.mockImplementation(() =>
          chain([
            {
              _id: t1,
              fechaApertura: d('2026-11-06'),
              fechaCierre: d('2026-11-06'),
            },
          ]),
        );
        const dentro = await service.alertas(d('2026-11-09'));
        expect(
          dentro.alertas.filter((x) => x.tipo === 'turno_sin_deposito'),
        ).toHaveLength(0);

        deposito.find.mockImplementation(() =>
          chain([{ turnoCajaId: t1, fecha: d('2026-11-09') }]),
        );
        const conDeposito = await service.alertas(d('2026-11-30'));
        expect(
          conDeposito.alertas.filter((x) => x.tipo === 'turno_sin_deposito'),
        ).toHaveLength(0);
      });

      it('avisa cuando pasan más de 5 días desde el último depósito', async () => {
        turno.find.mockImplementation(() => chain([]));
        deposito.find.mockImplementation(() =>
          chain([{ turnoCajaId: t1, fecha: d('2026-11-01') }]),
        );
        const r = await service.alertas(d('2026-11-07'));
        expect(r.alertas).toEqual([
          expect.objectContaining({
            tipo: 'maximo_dias_entre_depositos',
            diasTranscurridos: 6,
            maximo: 5,
          }),
        ]);
        const ok = await service.alertas(d('2026-11-06'));
        expect(ok.alertas).toHaveLength(0);
      });
    });
  });
});
