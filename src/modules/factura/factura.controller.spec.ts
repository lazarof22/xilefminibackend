import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FacturaController } from './factura.controller';
import { FacturaService } from './factura.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsuarioRol } from '../auth/schemas/usuarios.schema';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { UpdateFacturaDto } from './dto/update-factura.dto';
import { AnularFacturaDto } from './dto/anular-factura.dto';
import type { RequestWithUser } from '../auth/types/jwt-user.type';

/** Internal Nest metadata key set by `@UseGuards(...)` (guards.decorator.ts). */
const GUARDS_METADATA_KEY = '__guards__';
/** Metadata key set by `@Roles(...)` (see `roles.decorator.ts`). */
const ROLES_METADATA_KEY = 'roles';

describe('FacturaController', () => {
  let controller: FacturaController;
  let serviceMock: Partial<Record<keyof FacturaService, jest.Mock>>;

  beforeEach(async () => {
    serviceMock = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      exportar: jest.fn(),
      update: jest.fn(),
      terminar: jest.fn(),
      volverAEdicion: jest.fn(),
      confirmar: jest.fn(),
      cancelar: jest.fn(),
      anular: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FacturaController],
      providers: [{ provide: FacturaService, useValue: serviceMock }],
    }).compile();

    controller = module.get<FacturaController>(FacturaController);
  });

  afterEach(() => jest.restoreAllMocks());

  it('requires JWT authentication on every route (guards applied on the controller)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      FacturaController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  // These handlers are read purely to inspect Reflect metadata set by
  // decorators (`@Roles`) — they are never invoked, so the unbound `this`
  // that `unbound-method` normally warns about does not apply here.
  /* eslint-disable @typescript-eslint/unbound-method */
  const handlers: Record<string, (...args: never[]) => unknown> = {
    create: FacturaController.prototype.create,
    update: FacturaController.prototype.update,
    terminar: FacturaController.prototype.terminar,
    volverAEdicion: FacturaController.prototype.volverAEdicion,
    confirmar: FacturaController.prototype.confirmar,
    cancelar: FacturaController.prototype.cancelar,
    anular: FacturaController.prototype.anular,
    remove: FacturaController.prototype.remove,
    findAll: FacturaController.prototype.findAll,
    findOne: FacturaController.prototype.findOne,
    exportar: FacturaController.prototype.exportar,
  };
  /* eslint-enable @typescript-eslint/unbound-method */

  function rolesDe(nombreHandler: string): string[] | undefined {
    return Reflect.getMetadata(ROLES_METADATA_KEY, handlers[nombreHandler]) as
      string[] | undefined;
  }

  describe('write endpoints require administrador/gerente/facturador', () => {
    const rolesEsperados = [
      UsuarioRol.ADMIN,
      UsuarioRol.GERENTE,
      UsuarioRol.FACTURADOR,
    ];

    it.each(['create', 'update', 'terminar', 'volverAEdicion', 'confirmar'])(
      '%s carries the expected @Roles metadata',
      (nombre) => {
        expect(rolesDe(nombre)).toEqual(rolesEsperados);
      },
    );
  });

  describe('cancelar/anular/remove are restricted to administrador and gerente (doc 6.9)', () => {
    const contexto = (rol: string, nombre: string) =>
      ({
        getHandler: () => handlers[nombre],
        getClass: () => FacturaController,
        switchToHttp: () => ({ getRequest: () => ({ user: { rol } }) }),
      }) as unknown as ExecutionContext;

    it.each(['cancelar', 'anular', 'remove'])(
      '%s carries exactly [ADMIN, GERENTE]',
      (nombre) => {
        expect(rolesDe(nombre)).toEqual([UsuarioRol.ADMIN, UsuarioRol.GERENTE]);
      },
    );

    it.each(['cancelar', 'anular', 'remove'])(
      '%s: RolesGuard refuses facturador and cajero, allows admin and gerente',
      (nombre) => {
        const guard = new RolesGuard(new Reflector());
        expect(guard.canActivate(contexto(UsuarioRol.FACTURADOR, nombre))).toBe(
          false,
        );
        expect(guard.canActivate(contexto(UsuarioRol.CAJERO, nombre))).toBe(
          false,
        );
        expect(guard.canActivate(contexto(UsuarioRol.ADMIN, nombre))).toBe(
          true,
        );
        expect(guard.canActivate(contexto(UsuarioRol.GERENTE, nombre))).toBe(
          true,
        );
      },
    );
  });

  describe('read endpoints stay open to any authenticated user', () => {
    it.each(['findAll', 'findOne', 'exportar'])(
      '%s carries no @Roles metadata',
      (nombre) => {
        expect(rolesDe(nombre)).toBeUndefined();
      },
    );
  });

  const reqDe = (rol: string): RequestWithUser => ({
    user: { userId: 'user-1', nombre: 'Jefa', modulos: [], rol },
  });

  it('forwards the authenticated user id and role (req.user) to FacturaService.create', async () => {
    const dto = {} as CreateFacturaDto;
    const req = {
      user: {
        userId: 'user-1',
        nombre: 'facturador',
        modulos: [],
        rol: UsuarioRol.FACTURADOR,
      },
    } as RequestWithUser;
    (serviceMock.create as jest.Mock).mockResolvedValue({ id: 'FAC-000001' });

    await controller.create(dto, req);

    expect(serviceMock.create).toHaveBeenCalledWith(
      dto,
      'user-1',
      UsuarioRol.FACTURADOR,
    );
  });

  it('forwards the authenticated role to FacturaService.update (doc 6.9 price rule)', async () => {
    const dto = { concepto: 'x' } as UpdateFacturaDto;
    (serviceMock.update as jest.Mock).mockResolvedValue({ id: 'FAC-000001' });

    await controller.update('FAC-000001', dto, reqDe(UsuarioRol.GERENTE));

    expect(serviceMock.update).toHaveBeenCalledWith(
      'FAC-000001',
      dto,
      UsuarioRol.GERENTE,
    );
  });

  it('exportar forwards the id to FacturaService.exportar', async () => {
    (serviceMock.exportar as jest.Mock).mockResolvedValue({
      formato: 'factura-digital/1',
    });

    await expect(controller.exportar('FAC-000001')).resolves.toEqual({
      formato: 'factura-digital/1',
    });
    expect(serviceMock.exportar).toHaveBeenCalledWith('FAC-000001');
  });

  describe('state transitions (T6a) forward the id to the matching service method', () => {
    it.each([
      ['terminar', 'terminar'],
      ['volverAEdicion', 'volverAEdicion'],
      ['confirmar', 'confirmar'],
    ])('controller.%s forwards to service.%s', async (metodoControlador) => {
      (
        serviceMock[metodoControlador as keyof FacturaService] as jest.Mock
      ).mockResolvedValue({ id: 'FAC-000001' });

      await (
        controller[metodoControlador as keyof FacturaController] as unknown as (
          id: string,
        ) => Promise<unknown>
      )('FAC-000001');

      expect(
        serviceMock[metodoControlador as keyof FacturaService],
      ).toHaveBeenCalledWith('FAC-000001');
    });
  });
  describe('cancelar/anular/remove forward motivo and the authorizing user', () => {
    const req = reqDe(UsuarioRol.ADMIN);
    const actor = { userId: 'user-1', nombre: 'Jefa' };

    beforeEach(() => {
      for (const metodo of ['cancelar', 'anular', 'remove'] as const) {
        (serviceMock[metodo] as jest.Mock).mockResolvedValue({
          id: 'FAC-000001',
        });
      }
    });

    it('cancelar takes the motivo from the body', async () => {
      await controller.cancelar(
        'FAC-000001',
        { motivo: 'Error de precio' },
        req,
      );
      expect(serviceMock.cancelar).toHaveBeenCalledWith(
        'FAC-000001',
        'Error de precio',
        actor,
      );
    });

    it('anular takes the motivo from the body', async () => {
      await controller.anular('FAC-000001', { motivo: 'Duplicada' }, req);
      expect(serviceMock.anular).toHaveBeenCalledWith(
        'FAC-000001',
        'Duplicada',
        actor,
      );
    });

    it('remove (DELETE) takes the motivo from the ?motivo= query param', async () => {
      await controller.remove('FAC-000001', { motivo: 'Duplicada' }, req);
      expect(serviceMock.remove).toHaveBeenCalledWith(
        'FAC-000001',
        'Duplicada',
        actor,
      );
    });

    describe('global ValidationPipe on the body/query DTO', () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      const transformar = (tipo: 'body' | 'query', valor: unknown) =>
        pipe.transform(valor, { type: tipo, metatype: AnularFacturaDto });

      it.each(['body', 'query'] as const)(
        'rejects a missing or short motivo with 400 in %s',
        async (tipo) => {
          await expect(transformar(tipo, {})).rejects.toBeInstanceOf(
            BadRequestException,
          );
          await expect(
            transformar(tipo, { motivo: 'abc' }),
          ).rejects.toBeInstanceOf(BadRequestException);
        },
      );

      it('trims a valid motivo and rejects unknown properties', async () => {
        await expect(
          transformar('body', { motivo: '  Error de precio  ' }),
        ).resolves.toMatchObject({ motivo: 'Error de precio' });
        await expect(
          transformar('body', { motivo: 'Error de precio', otro: 1 }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });
});
