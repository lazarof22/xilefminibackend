import { InternalServerErrorException } from '@nestjs/common';
import { FakeModel } from '../inventario/exitencia/fake-mongo-spec';
import { ConfiguracionPagosService } from './configuracion-pagos.service';

const crear = (docs: Record<string, unknown>[] = []) => {
  const modelo = new FakeModel(docs, { unico: ['clave'] });
  return { modelo, servicio: new ConfiguracionPagosService(modelo as never) };
};

describe('ConfiguracionPagosService', () => {
  it('sin configurar rige la tasa del mercado informal', async () => {
    const { servicio } = crear();

    expect(await servicio.obtenerTipoTasa()).toBe('tasaMercadoInformal');
    expect(await servicio.obtener()).toEqual({
      tipoTasa: 'tasaMercadoInformal',
    });
  });

  it('usa la tasa configurada', async () => {
    const { servicio } = crear([
      { clave: 'pagos', tipoTasa: 'tasaBancoCentral' },
    ]);

    expect(await servicio.obtenerTipoTasa()).toBe('tasaBancoCentral');
  });

  it('un valor inválido en la base no se corrige en silencio: error 500 con la explicación', async () => {
    const { servicio } = crear([{ clave: 'pagos', tipoTasa: 'otra' }]);

    await expect(servicio.obtenerTipoTasa()).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(servicio.obtenerTipoTasa()).rejects.toThrow(
      /tasaBancoCentral o tasaMercadoInformal/,
    );
  });

  it('actualizar crea el documento la primera vez y lo cambia después, guardando quién lo hizo', async () => {
    const { modelo, servicio } = crear();

    await servicio.actualizar({ tipoTasa: 'tasaBancoCentral' }, 'admin');
    expect(modelo.docs).toHaveLength(1);
    expect(modelo.docs[0]).toMatchObject({
      clave: 'pagos',
      tipoTasa: 'tasaBancoCentral',
      actualizadoPor: 'admin',
    });

    await servicio.actualizar({ tipoTasa: 'tasaMercadoInformal' }, 'gerente');
    expect(modelo.docs).toHaveLength(1);
    expect(modelo.docs[0]).toMatchObject({
      tipoTasa: 'tasaMercadoInformal',
      actualizadoPor: 'gerente',
    });
    expect(await servicio.obtenerTipoTasa()).toBe('tasaMercadoInformal');
  });
});
