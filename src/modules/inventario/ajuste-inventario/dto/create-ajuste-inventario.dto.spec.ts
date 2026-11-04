import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateAjusteInventarioDto } from './create-ajuste-inventario.dto';

const id = () => new Types.ObjectId().toHexString();
const base = () => ({
  causa: 'Pérdida',
  autorizadoPor: 'Laura',
  firmadoPor: 'Pedro',
  lineas: [{ producto: id(), almacen: id(), contenedor: id(), ajuste: -2 }],
});
const errores = async (cuerpo: unknown) =>
  validate(plainToInstance(CreateAjusteInventarioDto, cuerpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('CreateAjusteInventarioDto', () => {
  it('acepta un ajuste completo', async () => {
    expect(await errores(base())).toHaveLength(0);
  });

  it.each(['saldoAntes', 'saldoDespues'])(
    'rechaza %s enviado por el cliente',
    async (campo) => {
      const cuerpo = base();
      Object.assign(cuerpo.lineas[0], { [campo]: 5 });
      expect(JSON.stringify(await errores(cuerpo))).toContain(
        'lo calcula el servidor',
      );
    },
  );

  it.each(['causa', 'autorizadoPor', 'firmadoPor'])(
    'exige %s',
    async (campo) => {
      const cuerpo = { ...base(), [campo]: '' };
      expect(await errores(cuerpo)).not.toHaveLength(0);
    },
  );
});
