import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CompraService } from './compra.service';
import { Compra, Pago } from './schema/compra.schema';
import {
  Empresa,
  tipoEmpresa,
} from '../../clientes y provedores/empresa/schema/empresa.schema';

const consulta = <T>(valor: T) => ({
  lean: () => ({ exec: () => Promise.resolve(valor) }),
  exec: () => Promise.resolve(valor),
});

describe('CompraService', () => {
  let service: CompraService;
  let compraModel: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    findByIdAndDelete: jest.Mock;
  };
  let empresaModel: { findOne: jest.Mock };

  const base = {
    numeroFactura: 'F-1',
    nombreProveedor: 'Proveedor SA',
    nombreProducto: 'Laptop',
    fechaCompra: '2026-10-13',
    moneda: 'CUP',
    precioCompra: 10.1,
    cantidad: 3,
    iva: 5,
    metodoPago: Pago.EFECTIVO,
  };

  beforeEach(async () => {
    compraModel = {
      create: jest.fn().mockImplementation((d: object) => Promise.resolve(d)),
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };
    empresaModel = { findOne: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        CompraService,
        { provide: getModelToken(Compra.name), useValue: compraModel },
        { provide: getModelToken(Empresa.name), useValue: empresaModel },
      ],
    }).compile();
    service = mod.get(CompraService);
  });

  it('CUP: calcula el total y descarta las tasas sin consultar al proveedor', async () => {
    const r = await service.create({
      ...base,
      tasaBancoNacional: 120,
      tasaMercadoInformal: 300,
    });
    expect(r).toMatchObject({ totalPagado: 30.3 });
    expect(r).not.toHaveProperty('tasaBancoNacional');
    expect(r).not.toHaveProperty('tasaMercadoInformal');
    expect(empresaModel.findOne).not.toHaveBeenCalled();
  });

  it('Mypime en USD: exige y guarda solo la tasa informal', async () => {
    empresaModel.findOne.mockReturnValue(
      consulta({ tipoEmpresa: tipoEmpresa.MYPIME }),
    );
    await expect(
      service.create({ ...base, moneda: 'USD', tasaBancoNacional: 120 }),
    ).rejects.toThrow(BadRequestException);
    const r = await service.create({
      ...base,
      moneda: 'USD',
      tasaMercadoInformal: 300,
      tasaBancoNacional: 120,
    });
    expect(r).toMatchObject({ tasaMercadoInformal: 300 });
    expect(r).not.toHaveProperty('tasaBancoNacional');
  });

  it('Empresa no Mypime en EUR: exige y guarda solo la tasa del banco', async () => {
    empresaModel.findOne.mockReturnValue(
      consulta({ tipoEmpresa: tipoEmpresa.ESTATAL }),
    );
    await expect(
      service.create({ ...base, moneda: 'EUR', tasaMercadoInformal: 300 }),
    ).rejects.toThrow(BadRequestException);
    const r = await service.create({
      ...base,
      moneda: 'EUR',
      tasaBancoNacional: 120,
    });
    expect(r).toMatchObject({ tasaBancoNacional: 120 });
    expect(r).not.toHaveProperty('tasaMercadoInformal');
  });

  it('rechaza un proveedor inexistente cuando la moneda no es CUP', async () => {
    empresaModel.findOne.mockReturnValue(consulta(null));
    await expect(
      service.create({ ...base, moneda: 'USD', tasaBancoNacional: 1 }),
    ).rejects.toThrow(/no existe/);
  });

  it('update: recalcula el total y obliga a reenviar la tasa si cambia la moneda', async () => {
    const doc = {
      moneda: 'CUP',
      nombreProveedor: 'Proveedor SA',
      numeroFactura: 'F-1',
      nombreProducto: 'Laptop',
      fechaCompra: new Date(),
      precioCompra: 10,
      cantidad: 2,
      iva: 0,
      metodoPago: Pago.EFECTIVO,
      set: jest.fn(),
      save: jest.fn().mockResolvedValue('guardado'),
    };
    compraModel.findById.mockReturnValue(consulta(doc));
    const id = new Types.ObjectId().toString();

    expect(await service.update(id, { cantidad: 5 })).toBe('guardado');
    expect(doc.set).toHaveBeenCalledWith(
      expect.objectContaining({ totalPagado: 50 }),
    );

    empresaModel.findOne.mockReturnValue(
      consulta({ tipoEmpresa: tipoEmpresa.PRIVADA }),
    );
    await expect(service.update(id, { moneda: 'USD' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('findOne / remove: id inválido o inexistente => 404', async () => {
    await expect(service.findOne('no-es-id')).rejects.toThrow(
      NotFoundException,
    );
    compraModel.findByIdAndDelete.mockReturnValue(consulta(null));
    await expect(
      service.remove(new Types.ObjectId().toString()),
    ).rejects.toThrow(NotFoundException);
  });
});
