import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { TurnoCajaService } from './turno-caja.service';
import { EstadoTurnoCaja, TurnoCaja } from './schema/turno-caja.schema';

const chain = <T>(valor: T) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'select', 'lean']) c[m] = jest.fn(() => c);
  c.exec = jest.fn().mockResolvedValue(valor);
  return c;
};

describe('TurnoCajaService', () => {
  let service: TurnoCajaService;
  let model: Record<string, jest.Mock>;
  const cajero = new Types.ObjectId();
  const usuario = {
    userId: cajero.toHexString(),
    nombre: 'Ana',
    rol: 'cajero',
  };

  beforeEach(async () => {
    model = {
      findOne: jest.fn(() => chain(null)),
      findById: jest.fn(() => chain(null)),
      find: jest.fn(() => chain([])),
      findOneAndUpdate: jest.fn(() => chain(null)),
      create: jest.fn(async (d: Record<string, unknown>) => ({
        toObject: () => ({ _id: new Types.ObjectId(), ...d }),
      })),
    };
    const mod = await Test.createTestingModule({
      providers: [
        TurnoCajaService,
        { provide: getModelToken(TurnoCaja.name), useValue: model },
      ],
    }).compile();
    service = mod.get(TurnoCajaService);
  });

  describe('abrir', () => {
    it('crea el turno abierto del cajero con el fondo inicial por moneda', async () => {
      const t = await service.abrir(usuario, {
        fondoInicial: { CUP: 5000, USD: 20 },
      });

      const doc = model.create.mock.calls[0][0];
      expect(doc.cajeroId).toEqual(cajero);
      expect(doc.cajeroNombre).toBe('Ana');
      expect(doc.estado).toBe(EstadoTurnoCaja.ABIERTO);
      expect(doc.fondoInicial).toEqual({ CUP: 5000, USD: 20 });
      expect(doc.fechaApertura).toBeInstanceOf(Date);
      expect(t.fondoInicial).toEqual({ CUP: 5000, USD: 20 });
    });

    it('rechaza un segundo turno abierto del mismo cajero', async () => {
      model.findOne.mockImplementation(() =>
        chain({ _id: new Types.ObjectId() }),
      );
      await expect(
        service.abrir(usuario, { fondoInicial: { CUP: 1 } }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('traduce la violación del índice único (carrera) a conflicto', async () => {
      model.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );
      await expect(
        service.abrir(usuario, { fondoInicial: { CUP: 1 } }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      [{}],
      [{ CUP: -1 }],
      [{ CUP: 'x' as unknown as number }],
      [{ '': 5 }],
      [{ 'C.UP': 5 }],
    ])('rechaza un fondo inválido %j', async (fondoInicial) => {
      await expect(
        service.abrir(usuario, { fondoInicial }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('acepta fondo 0 (turno sin fondo)', async () => {
      await service.abrir(usuario, { fondoInicial: { CUP: 0 } });
      expect(model.create).toHaveBeenCalled();
    });
  });

  describe('abiertoDe', () => {
    it('devuelve el turno abierto del cajero o null', async () => {
      expect(await service.abiertoDe(usuario.userId)).toBeNull();
      expect(model.findOne).toHaveBeenCalledWith({
        cajeroId: cajero,
        estado: EstadoTurnoCaja.ABIERTO,
      });
      model.findOne.mockImplementation(() =>
        chain({ _id: 't1', fondoInicial: { CUP: 1 } }),
      );
      expect(await service.abiertoDe(usuario.userId)).toMatchObject({
        _id: 't1',
      });
    });
  });

  describe('cerrar', () => {
    const id = new Types.ObjectId().toHexString();

    it('cierra de forma atómica un turno abierto del propio cajero', async () => {
      model.findById.mockImplementation(() =>
        chain({ _id: id, cajeroId: cajero, estado: EstadoTurnoCaja.ABIERTO }),
      );
      model.findOneAndUpdate.mockImplementation(() =>
        chain({ _id: id, estado: EstadoTurnoCaja.CERRADO }),
      );

      const r = await service.cerrar(id, usuario, { observaciones: 'ok' });

      const [filtro, cambio] = model.findOneAndUpdate.mock.calls[0];
      expect(filtro).toEqual({ _id: id, estado: EstadoTurnoCaja.ABIERTO });
      expect(cambio.$set).toMatchObject({
        estado: EstadoTurnoCaja.CERRADO,
        observacionesCierre: 'ok',
      });
      expect(cambio.$set.fechaCierre).toBeInstanceOf(Date);
      expect(r.estado).toBe(EstadoTurnoCaja.CERRADO);
    });

    it('un turno ajeno solo lo cierra el administrador', async () => {
      model.findById.mockImplementation(() =>
        chain({
          _id: id,
          cajeroId: new Types.ObjectId(),
          estado: EstadoTurnoCaja.ABIERTO,
        }),
      );
      await expect(service.cerrar(id, usuario, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();

      model.findOneAndUpdate.mockImplementation(() => chain({ _id: id }));
      await service.cerrar(id, { ...usuario, rol: 'administrador' }, {});
      expect(model.findOneAndUpdate).toHaveBeenCalled();
    });

    it('404 si no existe y 409 si ya está cerrado', async () => {
      await expect(service.cerrar(id, usuario, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      model.findById.mockImplementation(() =>
        chain({ _id: id, cajeroId: cajero, estado: EstadoTurnoCaja.CERRADO }),
      );
      await expect(service.cerrar(id, usuario, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.cerrar('no-id', usuario, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listar', () => {
    it('filtra por estado y cajero, más recientes primero', async () => {
      const c = chain([{ _id: 'a' }]);
      model.find.mockReturnValue(c);
      const r = await service.listar({
        estado: EstadoTurnoCaja.CERRADO,
        cajeroId: cajero.toHexString(),
      });
      expect(model.find).toHaveBeenCalledWith({
        estado: EstadoTurnoCaja.CERRADO,
        cajeroId: cajero,
      });
      expect(c.sort).toHaveBeenCalledWith({ fechaApertura: -1 });
      expect(r).toHaveLength(1);
    });
  });
});
