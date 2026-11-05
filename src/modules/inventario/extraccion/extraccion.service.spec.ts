import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ExtraccionService, type ActorExtraccion } from './extraccion.service';
import { AutorizadorSupervisorService } from '../../auth/autorizador-supervisor.service';
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
  const gerenteId = new Types.ObjectId();
  const actor = (rol: string): ActorExtraccion => ({
    userId: cajero.toHexString(),
    nombre: 'maria',
    rol,
  });
  let verificar: jest.Mock;
  let emitir: jest.Mock;

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
    verificar = jest
      .fn()
      .mockResolvedValue({ userId: gerenteId.toHexString(), nombre: 'jefe' });
    emitir = jest.fn().mockResolvedValue({ tokenAutorizador: 'tok' });
    const mod = await Test.createTestingModule({
      providers: [
        ExtraccionService,
        { provide: getModelToken(Extraccion.name), useValue: extraccionModel },
        { provide: getModelToken(TurnoCaja.name), useValue: turno },
        {
          provide: AutorizadorSupervisorService,
          useValue: { verificar, emitir },
        },
      ],
    }).compile();
    service = mod.get(ExtraccionService);
  });

  it('vincula la extracción al turno abierto del cajero y guarda la moneda', async () => {
    await service.create(
      { monto: 100, causa: 'Compra', moneda: 'USD' },
      actor('administrador'),
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

  it('sin turno abierto se rechaza con 409, no se guarda y no se consume la autorización', async () => {
    turno.findOne.mockImplementation(() => chain(null));
    await expect(
      service.create(
        { monto: 10, causa: 'x', tokenAutorizador: 'jwt' },
        actor('cajero'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(verificar).not.toHaveBeenCalled();
    expect(guardado).toBeUndefined();
  });

  it('la moneda por defecto es CUP', async () => {
    await service.create({ monto: 10, causa: 'x' }, actor('gerente'));
    expect(guardado?.moneda).toBe('CUP');
  });

  it('un cajero sin autorización de supervisor no extrae', async () => {
    await expect(
      service.create({ monto: 10, causa: 'x' }, actor('cajero')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(verificar).not.toHaveBeenCalled();
    expect(guardado).toBeUndefined();
  });

  it('un cajero con autorización: guarda quién autorizó, la verifica para ese cajero y no persiste el token', async () => {
    await service.create(
      { monto: 10, causa: 'x', tokenAutorizador: 'jwt-secreto' },
      actor('cajero'),
    );
    expect(verificar).toHaveBeenCalledWith('jwt-secreto', cajero.toHexString());
    expect(guardado?.autorizadoPor).toEqual({
      usuarioId: gerenteId,
      nombre: 'jefe',
    });
    expect(JSON.stringify(guardado)).not.toContain('jwt-secreto');
  });

  it('emite la autorización para el usuario de la sesión', async () => {
    await service.emitirAutorizacion(
      { nombre: 'jefe', contraseña: 'clave' },
      actor('cajero'),
    );
    expect(emitir).toHaveBeenCalledWith('jefe', 'clave', cajero.toHexString());
  });

  it('si el cajero es administrador ignora el token y se autoriza a sí mismo', async () => {
    await service.create(
      { monto: 10, causa: 'x', tokenAutorizador: 'jwt' },
      actor('administrador'),
    );
    expect(verificar).not.toHaveBeenCalled();
    expect(guardado?.autorizadoPor).toEqual({
      usuarioId: cajero,
      nombre: 'maria',
    });
  });

  it('sigue rechazando montos no positivos', async () => {
    await expect(
      service.create({ monto: 0, causa: 'x' }, actor('administrador')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
