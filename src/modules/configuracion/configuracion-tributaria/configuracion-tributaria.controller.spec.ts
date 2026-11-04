import { Test } from '@nestjs/testing';
import { ConfiguracionTributariaController } from './configuracion-tributaria.controller';
import { ConfiguracionTributariaService } from './configuracion-tributaria.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UsuarioRol } from '../../auth/schemas/usuarios.schema';

const GUARDS_METADATA_KEY = '__guards__';
const ROLES_METADATA_KEY = 'roles';

describe('ConfiguracionTributariaController', () => {
  let controller: ConfiguracionTributariaController;
  let service: Record<'obtenerActiva' | 'guardar' | 'historial', jest.Mock>;

  beforeEach(async () => {
    service = {
      obtenerActiva: jest.fn().mockResolvedValue(null),
      guardar: jest.fn().mockResolvedValue({ impuestoVentasPct: 10 }),
      historial: jest.fn().mockResolvedValue([]),
    };
    const mod = await Test.createTestingModule({
      controllers: [ConfiguracionTributariaController],
      providers: [
        { provide: ConfiguracionTributariaService, useValue: service },
      ],
    }).compile();
    controller = mod.get(ConfiguracionTributariaController);
  });

  it('exige JWT en todas las rutas (guards en el controlador)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA_KEY,
      ConfiguracionTributariaController,
    ) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('PUT solo para administrador, gerente y económico', () => {
    const roles = Reflect.getMetadata(
      ROLES_METADATA_KEY,
      ConfiguracionTributariaController.prototype.guardar,
    ) as string[];
    expect([...roles].sort()).toEqual(
      [UsuarioRol.ADMIN, UsuarioRol.GERENTE, UsuarioRol.ECONOMICO].sort(),
    );
  });

  it('GET queda abierto a cualquier usuario autenticado (sin @Roles)', () => {
    expect(
      Reflect.getMetadata(
        ROLES_METADATA_KEY,
        ConfiguracionTributariaController.prototype.obtenerActiva,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        ROLES_METADATA_KEY,
        ConfiguracionTributariaController.prototype.historial,
      ),
    ).toBeUndefined();
  });

  it('GET devuelve null si no hay configuración', async () => {
    await expect(controller.obtenerActiva()).resolves.toBeNull();
  });

  it('PUT delega el DTO al servicio', async () => {
    const dto = { impuestoVentasPct: 10, vigenteDesde: '2026-11-01' };
    await controller.guardar(dto);
    expect(service.guardar).toHaveBeenCalledWith(dto);
  });
});
