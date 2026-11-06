import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PagoCheckoutDto } from './dto/pago-checkout.dto';
import { PagoService } from './pago.service';

/**
 * Validación del pago del checkout contra el total que calculó el servidor:
 * el cliente solo dice CÓMO paga; el efectivo recibido sale del desglose.
 */
const servicio = new PagoService(
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
);

const pago = (datos: Record<string, unknown>): PagoCheckoutDto =>
  datos as unknown as PagoCheckoutDto;

describe('PagoService.prepararPagoCheckout', () => {
  describe('efectivo', () => {
    it('el recibido es la suma del desglose y el cambio se calcula en el servidor', () => {
      const r = servicio.prepararPagoCheckout(
        pago({
          tipo: 'efectivo',
          desglose: { billete500: 1, billete100: 2, billete3: 1, billete1: 1 },
        }),
        385,
      );

      expect(r).toMatchObject({
        tipo: 'efectivo',
        montoRecibido: 704,
        cambio: 319,
        esCuentaCasa: false,
      });
      expect(r.documento).toMatchObject({
        monto_pagado: 704,
        monto_pagar_CUP: 385,
        cambio: 319,
        cliente: 'cliente-estandar',
        metodoPago: 'efectivo',
      });
      expect((r.documento.desglose as Record<string, number>).billete3).toBe(1);
    });

    it('paga justo: cambio 0', () => {
      const r = servicio.prepararPagoCheckout(
        pago({ tipo: 'efectivo', desglose: { billete200: 1, billete20: 1 } }),
        220,
      );

      expect(r.cambio).toBe(0);
    });

    it('redondea el cambio a 2 decimales', () => {
      const r = servicio.prepararPagoCheckout(
        pago({ tipo: 'efectivo', desglose: { billete20: 1 } }),
        12.34,
      );

      expect(r.cambio).toBe(7.66);
    });

    it('menos que el total → 400 con las cifras', () => {
      expect(() =>
        servicio.prepararPagoCheckout(
          pago({ tipo: 'efectivo', desglose: { billete100: 3 } }),
          385,
        ),
      ).toThrow(/300\.00.*385\.00/);
    });

    it('sin desglose (o en cero) → 400', () => {
      expect(() =>
        servicio.prepararPagoCheckout(pago({ tipo: 'efectivo' }), 10),
      ).toThrow(BadRequestException);
      expect(() =>
        servicio.prepararPagoCheckout(
          pago({ tipo: 'efectivo', desglose: { billete100: 0 } }),
          10,
        ),
      ).toThrow(/desglose de billetes es obligatorio/);
    });

    it('cliente por descuento: exige nombre, CI y teléfono', () => {
      const base = {
        tipo: 'efectivo',
        tipoCliente: 'cliente-por-descuento',
        desglose: { billete100: 1 },
      };

      expect(() => servicio.prepararPagoCheckout(pago(base), 50)).toThrow(
        /Nombre, CI y Teléfono/,
      );
      expect(() =>
        servicio.prepararPagoCheckout(
          pago({
            ...base,
            datosClienteDescuento: { nombre: 'Ana', ci: '123' },
          }),
          50,
        ),
      ).toThrow(/Nombre, CI y Teléfono/);

      const r = servicio.prepararPagoCheckout(
        pago({
          ...base,
          datosClienteDescuento: { nombre: 'Ana', ci: '123', telefono: '555' },
        }),
        50,
      );
      expect(r.documento.datosClienteDescuento).toEqual({
        nombre: 'Ana',
        ci: '123',
        telefono: '555',
      });
    });

    it('cuenta casa: no se recibe efectivo; con desglose → 400, sin él se registra el total sin cobrar', () => {
      const casa = { tipo: 'efectivo', tipoCliente: 'cliente-cuenta-casa' };

      expect(() =>
        servicio.prepararPagoCheckout(
          pago({ ...casa, desglose: { billete100: 1 } }),
          50,
        ),
      ).toThrow(/cuenta casa no se recibe efectivo/);

      const r = servicio.prepararPagoCheckout(pago(casa), 50);
      expect(r).toMatchObject({
        esCuentaCasa: true,
        montoRecibido: 0,
        cambio: 0,
      });
      expect(r.documento).toMatchObject({
        monto_pagar_CUP: 50,
        esCuentaCasa: true,
        monto_pagado: 0,
      });
    });
  });

  describe('crédito', () => {
    it('exige cliente', () => {
      expect(() =>
        servicio.prepararPagoCheckout(pago({ tipo: 'credito' }), 100),
      ).toThrow(/cliente es obligatorio/);
    });

    it('con cliente guarda el total a crédito', () => {
      const clienteId = new Types.ObjectId();

      const r = servicio.prepararPagoCheckout(
        pago({ tipo: 'credito' }),
        100,
        clienteId,
      );

      expect(r).toMatchObject({ tipo: 'credito', montoRecibido: 0, cambio: 0 });
      expect(r.documento).toEqual({
        clienteId,
        monto_pagar: 100,
        metodoPago: 'credito',
      });
    });
  });

  describe('transferencia', () => {
    it('exige referencia y banco', () => {
      expect(() =>
        servicio.prepararPagoCheckout(
          pago({ tipo: 'transferencia', banco: 'BPA' }),
          100,
        ),
      ).toThrow(/referencia/);
      expect(() =>
        servicio.prepararPagoCheckout(
          pago({ tipo: 'transferencia', numeroCuenta: '123' }),
          100,
        ),
      ).toThrow(/banco/);
    });

    it('acepta la referencia como número de cuenta o como referencia de pago', () => {
      const a = servicio.prepararPagoCheckout(
        pago({ tipo: 'transferencia', numeroCuenta: 'ACC-1', banco: 'BPA' }),
        100,
      );
      const b = servicio.prepararPagoCheckout(
        pago({
          tipo: 'transferencia',
          referenciaPago: 'REF-9',
          banco: 'BANDEC',
        }),
        100,
      );

      expect(a.documento).toMatchObject({
        montoPagar: 100,
        numeroCuenta: 'ACC-1',
        referenciaPago: 'ACC-1',
        banco: 'BPA',
      });
      expect(b.documento).toMatchObject({
        montoPagar: 100,
        numeroCuenta: 'REF-9',
        referenciaPago: 'REF-9',
        banco: 'BANDEC',
      });
    });
  });

  it('un tipo de pago desconocido → 400', () => {
    expect(() =>
      servicio.prepararPagoCheckout(pago({ tipo: 'cripto' }), 100),
    ).toThrow(/Tipo de pago no válido/);
  });
});
