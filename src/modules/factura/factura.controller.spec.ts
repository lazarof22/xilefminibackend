import { Test, TestingModule } from '@nestjs/testing';
import { FacturaController } from './factura.controller';
import { FacturaService } from './factura.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UsuarioRol } from '../auth/schemas/empleado.schema';
import { CreateFacturaDto } from './dto/create-factura.dto';
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

    it.each([
      'create',
      'update',
      'terminar',
      'volverAEdicion',
      'confirmar',
      'cancelar',
      'anular',
      'remove',
    ])('%s carries the expected @Roles metadata', (nombre) => {
      expect(rolesDe(nombre)).toEqual(rolesEsperados);
    });
  });

  describe('read endpoints stay open to any authenticated user', () => {
    it.each(['findAll', 'findOne'])(
      '%s carries no @Roles metadata',
      (nombre) => {
        expect(rolesDe(nombre)).toBeUndefined();
      },
    );
  });

  it('forwards the authenticated user id (req.user.userId) to FacturaService.create', async () => {
    const dto = {} as CreateFacturaDto;
    const req = {
      user: {
        userId: 'user-1',
        correo_empleado: 'facturador@xilef.test',
        rol: UsuarioRol.FACTURADOR,
      },
    } as RequestWithUser;
    (serviceMock.create as jest.Mock).mockResolvedValue({ id: 'FAC-000001' });

    await controller.create(dto, req);

    expect(serviceMock.create).toHaveBeenCalledWith(dto, 'user-1');
  });

  describe('state transitions (T6a) forward the id to the matching service method', () => {
    it.each([
      ['terminar', 'terminar'],
      ['volverAEdicion', 'volverAEdicion'],
      ['confirmar', 'confirmar'],
      ['cancelar', 'cancelar'],
      ['anular', 'anular'],
      ['remove', 'remove'],
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
});
