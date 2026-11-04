import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateRecepcionDto } from './create-recepcion.dto';

const id = () => new Types.ObjectId().toHexString();
const base = () => ({
  almacenReceptor: id(),
  proveedor: id(),
  documentoOrigen: { tipo: 'factura', numero: 'F-1', fecha: '2026-10-05' },
  responsableComprobacion: 'Ana',
  lineas: [
    { producto: id(), contenedor: id(), cantidad: 2, costo_unitario: 3 },
  ],
});
const errores = async (cuerpo: unknown) =>
  validate(plainToInstance(CreateRecepcionDto, cuerpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('CreateRecepcionDto', () => {
  it('acepta un borrador completo', async () => {
    expect(await errores(base())).toHaveLength(0);
  });

  it.each([
    'total',
    'numeroConsecutivo',
    'inventarioAplicado',
    'responsableRecepcion',
  ])('no acepta %s: lo fija el servidor', async (campo) => {
    expect(await errores({ ...base(), [campo]: 'x' })).not.toHaveLength(0);
  });

  it('exige el documento de origen y al menos una línea', async () => {
    const sinOrigen: Record<string, unknown> = base();
    delete sinOrigen.documentoOrigen;
    expect(await errores(sinOrigen)).not.toHaveLength(0);
    expect(await errores({ ...base(), lineas: [] })).not.toHaveLength(0);
  });

  it('rechaza un tipo de documento de origen desconocido', async () => {
    const cuerpo = base();
    cuerpo.documentoOrigen.tipo = 'recibo';
    expect(await errores(cuerpo)).not.toHaveLength(0);
  });
});
