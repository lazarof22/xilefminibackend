import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { LicenciaController } from './licencia.controller';
import { LicenciaService } from './licencia.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { RequestConUsuario } from './licencia.controller';

type Handler = keyof LicenciaController;

function handlerOf(handler: Handler): object {
  return Object.getOwnPropertyDescriptor(LicenciaController.prototype, handler)
    ?.value as object;
}

function guardsOf(handler: Handler): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, handlerOf(handler)) ??
    []) as unknown[];
}

function rolesOf(handler: Handler): string[] | undefined {
  return Reflect.getMetadata('roles', handlerOf(handler)) as
    string[] | undefined;
}

function req(user: { rol: string; empresa_id?: string }): RequestConUsuario {
  return {
    user: { userId: 'u1', correo_empleado: 'a@b.c', ...user },
    headers: { 'user-agent': 'jest' },
    ip: '127.0.0.1',
  };
}

describe('LicenciaController', () => {
  let service: {
    estadoPublico: jest.Mock;
    estadoUsuario: jest.Mock;
    generarSolicitud: jest.Mock;
    importarLicencia: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    getAuditoria: jest.Mock;
  };
  let controller: LicenciaController;

  beforeEach(() => {
    service = {
      estadoPublico: jest
        .fn()
        .mockResolvedValue({ valida: true, estado: 'valida' }),
      estadoUsuario: jest.fn().mockResolvedValue({ valida: true }),
      generarSolicitud: jest.fn().mockResolvedValue({ version: 1 }),
      importarLicencia: jest.fn().mockResolvedValue({ resultado: 'activada' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      getAuditoria: jest.fn().mockResolvedValue([]),
    };
    controller = new LicenciaController(service as unknown as LicenciaService);
  });

  describe('route protection', () => {
    it.each<Handler>([
      'activar',
      'solicitud',
      'auditoria',
      'listarTodas',
      'obtenerUna',
    ])('%s requires JWT + administrador', (handler) => {
      expect(guardsOf(handler)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(rolesOf(handler)).toEqual(['administrador']);
    });

    it('estado requires JWT only', () => {
      expect(guardsOf('verificarEstado')).toEqual([JwtAuthGuard]);
    });

    it('public estado has no auth guard', () => {
      expect(guardsOf('estadoPublico')).toEqual([]);
    });

    it('the legacy key-format endpoint is gone', () => {
      expect(
        (controller as unknown as Record<string, unknown>).validarClave,
      ).toBeUndefined();
    });
  });

  it('public estado returns only { valida, estado }', async () => {
    await expect(controller.estadoPublico()).resolves.toEqual({
      valida: true,
      estado: 'valida',
    });
  });

  it('estado uses the empresa of the JWT', async () => {
    await controller.verificarEstado(
      req({ rol: 'empleado', empresa_id: 'EMP-1' }),
    );
    expect(service.estadoUsuario).toHaveBeenCalledWith('EMP-1');
  });

  it('activar forwards the artifact and the admin empresa', async () => {
    const dto = { version_firma: 3, payload: {}, firma: 'x' };
    await controller.activar(
      dto as unknown as Parameters<LicenciaController['activar']>[0],
      req({ rol: 'administrador', empresa_id: 'EMP-1' }),
    );
    expect(service.importarLicencia).toHaveBeenCalledWith(
      { version_firma: 3, payload: {}, firma: 'x' },
      { empresaIdUsuario: 'EMP-1', ip: '127.0.0.1', userAgent: 'jest' },
    );
  });

  describe('solicitud', () => {
    const res = () => ({ setHeader: jest.fn() });

    it('defaults to the JWT empresa', async () => {
      await controller.solicitud(
        {},
        req({ rol: 'administrador', empresa_id: 'EMP-1' }),
        res(),
      );
      expect(service.generarSolicitud).toHaveBeenCalledWith(
        'EMP-1',
        expect.any(Object),
      );
    });

    it('accepts an explicit empresa_id', async () => {
      await controller.solicitud(
        { empresa_id: 'EMP-2' },
        req({ rol: 'administrador' }),
        res(),
      );
      expect(service.generarSolicitud).toHaveBeenCalledWith(
        'EMP-2',
        expect.any(Object),
      );
    });

    it('requires some empresa_id', async () => {
      await expect(
        controller.solicitud({}, req({ rol: 'administrador' }), res()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sets an attachment header when descargar=true', async () => {
      const r = res();
      await controller.solicitud(
        { empresa_id: 'EMP 2/x', descargar: 'true' },
        req({ rol: 'administrador' }),
        r,
      );
      expect(r.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="xilef-EMP_2_x.req"',
      );
    });
  });
});
