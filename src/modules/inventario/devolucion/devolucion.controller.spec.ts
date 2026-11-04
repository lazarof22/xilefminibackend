/* eslint-disable @typescript-eslint/unbound-method */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';
import { DevolucionController } from './devolucion.controller';
import { CreateDevolucionDto } from './dto/create-devolucion.dto';
import { ListarDevolucionesQueryDto } from './dto/listar-devoluciones-query.dto';

const contexto = (rol: string, handler: (...a: never[]) => unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => DevolucionController,
    switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
  }) as unknown as ExecutionContext;

const proto = DevolucionController.prototype;

const dtoValido = {
  tipo: 'venta',
  origenTipo: 'venta',
  origenRef: '507f1f77bcf86cd799439011',
  motivo: 'Mal estado',
  lineas: [
    {
      producto: '507f1f77bcf86cd7994390aa',
      cantidadSolicitada: 2,
      cantidadEntregada: 2,
    },
  ],
  autorizadoPor: 'Ana',
  recibidoPor: 'Luis',
  firma: 'firma',
};

describe('DevolucionController', () => {
  it('exige JWT y roles', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      DevolucionController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('crear: solo administrador y gerente (S11 anular factura / venta)', () => {
    expect(Reflect.getMetadata('roles', proto.crear)).toEqual([
      UsuarioRol.ADMIN,
      UsuarioRol.GERENTE,
    ]);
    const guard = new RolesGuard(new Reflector());
    for (const rol of [UsuarioRol.ADMIN, UsuarioRol.GERENTE]) {
      expect(guard.canActivate(contexto(rol, proto.crear))).toBe(true);
    }
    for (const rol of [
      UsuarioRol.CAJERO,
      UsuarioRol.FACTURADOR,
      UsuarioRol.ECONOMICO,
      UsuarioRol.EMPLEADO,
    ]) {
      expect(guard.canActivate(contexto(rol, proto.crear))).toBe(false);
    }
  });

  it('listar y detalle quedan abiertos a cualquier usuario autenticado', () => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of [proto.listar, proto.findOne]) {
      expect(Reflect.getMetadata('roles', handler)).toBeUndefined();
      expect(guard.canActivate(contexto(UsuarioRol.CAJERO, handler))).toBe(
        true,
      );
    }
  });
});

describe('CreateDevolucionDto', () => {
  const errores = async (datos: object) =>
    (await validate(plainToInstance(CreateDevolucionDto, datos))).map(
      (e) => e.property,
    );

  it('acepta un vale completo', async () => {
    expect(await errores(dtoValido)).toEqual([]);
  });

  it.each(['motivo', 'autorizadoPor', 'recibidoPor', 'firma'])(
    '%s es obligatorio y no puede ir vacío',
    async (campo) => {
      expect(await errores({ ...dtoValido, [campo]: '' })).toContain(campo);
      expect(await errores({ ...dtoValido, [campo]: undefined })).toContain(
        campo,
      );
    },
  );

  it('el origen es obligatorio y debe ser un id válido', async () => {
    expect(await errores({ ...dtoValido, origenRef: undefined })).toContain(
      'origenRef',
    );
    expect(await errores({ ...dtoValido, origenRef: 'abc' })).toContain(
      'origenRef',
    );
  });

  it('exige al menos una línea con cantidades no negativas', async () => {
    expect(await errores({ ...dtoValido, lineas: [] })).toContain('lineas');
    const negativa = await validate(
      plainToInstance(CreateDevolucionDto, {
        ...dtoValido,
        lineas: [{ ...dtoValido.lineas[0], cantidadEntregada: -1 }],
      }),
    );
    expect(negativa).toHaveLength(1);
  });
});

describe('ListarDevolucionesQueryDto', () => {
  it('valida forma de dinero y fechas del filtro de caja', async () => {
    const ok = await validate(
      plainToInstance(ListarDevolucionesQueryDto, {
        formaDevolucionDinero: 'efectivo',
        desde: '2026-11-01',
        hasta: '2026-11-03',
      }),
    );
    expect(ok).toHaveLength(0);

    const mal = await validate(
      plainToInstance(ListarDevolucionesQueryDto, {
        formaDevolucionDinero: 'bitcoin',
        desde: 'ayer',
      }),
    );
    expect(mal.map((e) => e.property).sort()).toEqual([
      'desde',
      'formaDevolucionDinero',
    ]);
  });
});
