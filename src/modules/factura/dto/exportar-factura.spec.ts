import { Factura } from '../schema/factura.schema';
import { EstadoFactura } from '../factura.constants';
import { FORMATO_FACTURA_DIGITAL, exportarFactura } from './exportar-factura';

function facturaBase(campos: Record<string, unknown> = {}): Factura {
  return {
    id: 'FAC-000007',
    numero: 7,
    fecha: '2026-10-01',
    cliente: 'Cliente SA',
    nit: '123',
    direccion: 'Calle 1',
    telefono: '555',
    email: 'a@b.cu',
    moneda: 'CUP',
    estado: EstadoFactura.CONFIRMADA,
    emisor: { nombre: 'Mi Empresa', nit: '999', ciudad: 'La Habana' },
    items: [
      {
        id: 'i1',
        productoId: 'p1',
        productoNombre: 'Arroz',
        cantidad: 2,
        precio: 100,
        costo: 60,
        descuentoPct: 10,
        descuentoMonto: 5,
        recargo: 3,
        total: 178,
      },
    ],
    subtotal: 200,
    descuentoTotal: 25,
    recargoTotal: 3,
    impuesto: { tipo: 'IVA', porciento: 10, importe: 17.8 },
    total: 195.8,
    facturadoPor: { nombre: 'Ana', ci: '', fecha: '2026-10-01' },
    ...campos,
  } as unknown as Factura;
}

describe('exportarFactura', () => {
  it('maps the stored invoice to the factura-digital/1 document', () => {
    const doc = exportarFactura(facturaBase());

    expect(doc).toEqual({
      formato: FORMATO_FACTURA_DIGITAL,
      numero: 7,
      estado: EstadoFactura.CONFIRMADA,
      fecha: '2026-10-01',
      emisor: { nombre: 'Mi Empresa', nit: '999', ciudad: 'La Habana' },
      cliente: {
        nombre: 'Cliente SA',
        nit: '123',
        direccion: 'Calle 1',
        telefono: '555',
        email: 'a@b.cu',
      },
      items: [
        {
          producto: 'Arroz',
          cantidad: 2,
          precio: 100,
          descuento: 25,
          recargo: 3,
          total: 178,
        },
      ],
      totales: {
        subtotal: 200,
        descuentoTotal: 25,
        recargoTotal: 3,
        impuesto: 17.8,
        total: 195.8,
      },
      facturadoPor: 'Ana',
    });
    expect(FORMATO_FACTURA_DIGITAL).toBe('factura-digital/1');
  });

  it('item descuento is the line discount (monto + pct of gross)', () => {
    const doc = exportarFactura(facturaBase());
    // 5 + 200 * 10 / 100 = 25
    expect(doc.items[0].descuento).toBe(25);
  });

  it('never leaks internal fields (costo, ids, inventory bookkeeping)', () => {
    const texto = JSON.stringify(
      exportarFactura(
        facturaBase({
          inventarioAplicado: true,
          inventarioUbicaciones: [{ cantidad: 1 }],
          revision: 3,
        }),
      ),
    );
    expect(texto).not.toContain('costo');
    expect(texto).not.toContain('inventario');
    expect(texto).not.toContain('revision');
    expect(texto).not.toContain('productoId');
  });

  it('falls back to 0 impuesto and omits facturadoPor/anulacion when absent', () => {
    const doc = exportarFactura(
      facturaBase({
        impuesto: undefined,
        facturadoPor: undefined,
        emisor: undefined,
      }),
    );
    expect(doc.totales.impuesto).toBe(0);
    expect(doc.facturadoPor).toBeUndefined();
    expect(doc.anulacion).toBeUndefined();
    expect(doc.emisor).toBeUndefined();
  });

  it.each([EstadoFactura.CANCELADA, EstadoFactura.ANULADA])(
    'includes anulacion for a %s invoice',
    (estado) => {
      const fecha = new Date('2026-10-02T10:00:00.000Z');
      const doc = exportarFactura(
        facturaBase({
          estado,
          motivoAnulacion: 'Error de precio',
          anuladaPor: { userId: 'u1', nombre: 'Jefe' },
          fechaAnulacion: fecha,
        }),
      );
      expect(doc.anulacion).toEqual({
        motivo: 'Error de precio',
        anuladaPor: { userId: 'u1', nombre: 'Jefe' },
        fecha,
      });
    },
  );

  it('omits anulacion when the invoice carries no annulment data (legacy)', () => {
    const doc = exportarFactura(facturaBase({ estado: EstadoFactura.ANULADA }));
    expect(doc.anulacion).toBeUndefined();
  });
});
