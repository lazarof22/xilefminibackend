import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnularFacturaDto } from './anular-factura.dto';

async function errores(plano: Record<string, unknown>) {
  return validate(plainToInstance(AnularFacturaDto, plano));
}

describe('AnularFacturaDto', () => {
  it('accepts a motivo of 5 to 300 characters and trims it', async () => {
    const instancia = plainToInstance(AnularFacturaDto, {
      motivo: '  Error de precio  ',
    });
    expect(await validate(instancia)).toHaveLength(0);
    expect(instancia.motivo).toBe('Error de precio');
    expect(await errores({ motivo: 'a'.repeat(5) })).toHaveLength(0);
    expect(await errores({ motivo: 'a'.repeat(300) })).toHaveLength(0);
  });

  it('rejects a missing motivo', async () => {
    const e = await errores({});
    expect(e.some((x) => x.property === 'motivo')).toBe(true);
  });

  it('rejects a motivo shorter than 5 characters after trimming', async () => {
    expect(await errores({ motivo: '  abcd  ' })).not.toHaveLength(0);
    expect(await errores({ motivo: '     ' })).not.toHaveLength(0);
  });

  it('rejects a motivo longer than 300 characters', async () => {
    expect(await errores({ motivo: 'a'.repeat(301) })).not.toHaveLength(0);
  });

  it('rejects a non-string motivo', async () => {
    expect(await errores({ motivo: 12345 })).not.toHaveLength(0);
  });

  it('reports Spanish messages', async () => {
    const e = await errores({ motivo: 'abc' });
    const mensajes = e.flatMap((x) => Object.values(x.constraints ?? {}));
    expect(mensajes.join(' ')).toContain('al menos 5 caracteres');
  });
});
