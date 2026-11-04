import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExtraccionService } from './extraccion.service';
import { Extraccion } from './schema/extraccion.schema';
import {
  EstadoTurnoCaja,
  TurnoCaja,
} from '../turno-caja/schema/turno-caja.schema';

const chain = <T>(valor: T) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'select', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn().mockResolvedValue(valor);
  return c;
};

describe('ExtraccionService', () => {
  let service: ExtraccionService;
  let guardado: Record<string, unknown> | undefined;
  let turno: Record<string, jest.Mock>;
  const cajero = new Types.ObjectId();
  const turnoId = new Types.ObjectId();

  beforeEach(async () => {
    guardado = undefined;
    const extraccionModel = Object.assign(
      jest.fn().mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        save: () => {
          guardado = data;
          return Promise.resolve(data);
        },
      })),
      { find: jest.fn(), findById: jest.fn(), findByIdAndDelete: jest.fn() },
    );
    turno = { findOne: jest.fn(() => chain({ _id: turnoId })) };
    const mod = await Test.createTestingModule({
      providers: [
        ExtraccionService,
        { provide: getModelToken(Extraccion.name), useValue: extraccionModel },
        { provide: getModelToken(TurnoCaja.name), useValue: turno },
      ],
    }).compile();
    service = mod.get(ExtraccionService);
  });

  it('vincula la extracción al turno abierto del cajero y guarda la moneda', async () => {
    await service.create(
      { monto: 100, causa: 'Compra', moneda: 'USD' },
      cajero.toHexString(),
    );
    expect(turno.findOne).toHaveBeenCalledWith({
      cajeroId: cajero,
      estado: EstadoTurnoCaja.ABIERTO,
    });
    expect(guardado).toMatchObject({
      monto: 100,
      causa: 'Compra',
      moneda: 'USD',
      turnoCaja: turnoId,
      empleadoId: cajero,
    });
  });

  it('sin turno abierto sigue funcionando: turnoCaja queda sin definir y la moneda es CUP', async () => {
    turno.findOne.mockImplementation(() => chain(null));
    await service.create({ monto: 10, causa: 'x' }, cajero.toHexString());
    expect(guardado?.turnoCaja).toBeUndefined();
    expect(guardado?.moneda).toBe('CUP');
  });

  it('sin usuario autenticado (flujo actual) no consulta turnos', async () => {
    await service.create({ monto: 10, causa: 'x' });
    expect(turno.findOne).not.toHaveBeenCalled();
    expect(guardado?.turnoCaja).toBeUndefined();
    expect(guardado?.empleadoId).toBeUndefined();
  });

  it('sigue rechazando montos no positivos', async () => {
    await expect(
      service.create({ monto: 0, causa: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
