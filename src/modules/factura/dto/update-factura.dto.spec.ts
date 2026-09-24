import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFacturaDto } from './update-factura.dto';

describe('UpdateFacturaDto (T3)', () => {
  it('accepts only concepto, impreso, direccion, telefono, email and the participants', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      concepto: 'Nuevo concepto',
      impreso: true,
      direccion: 'Calle 1',
      telefono: '5555',
      email: 'a@b.com',
      despachadoPor: {
        nombre: 'Juan Perez',
        ci: '12345678901',
        fecha: '2026-09-22',
      },
      transportadoPor: {
        nombre: 'Ana Lopez',
        ci: '12345678902',
        fecha: '2026-09-22',
      },
      recibidoPor: {
        nombre: 'Luis Diaz',
        ci: '12345678903',
        fecha: '2026-09-22',
      },
    });
    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errores).toHaveLength(0);
  });

  it('rejects an invalid nested participant (empty nombre)', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      despachadoPor: { nombre: '  ', ci: '12345678901', fecha: '2026-09-22' },
    });
    const errores = await validate(instancia);
    expect(errores.some((e) => e.property === 'despachadoPor')).toBe(true);
  });

  it('rejects items, numero, estado, fecha, nit, totals and almacenId/almacenCodigo (not mutable via update)', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {
      concepto: 'x',
      items: [],
      numero: 5,
      estado: 'anulada',
      fecha: '2026-01-01',
      nit: '123',
      total: 999,
      almacenId: '507f1f77bcf86cd799439011',
      almacenCodigo: 'ALM-001',
    });
    const errores = await validate(instancia, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const propiedadesRechazadas = errores.map((e) => e.property);
    for (const campo of [
      'items',
      'numero',
      'estado',
      'fecha',
      'nit',
      'total',
      'almacenId',
      'almacenCodigo',
    ]) {
      expect(propiedadesRechazadas).toContain(campo);
    }
  });

  it('has every field optional', async () => {
    const instancia = plainToInstance(UpdateFacturaDto, {});
    const errores = await validate(instancia);
    expect(errores).toHaveLength(0);
  });
});
