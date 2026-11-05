import {
  calcularEfectivoEsperado,
  MONEDA_POR_DEFECTO,
  monedaDelPago,
  resumirPorMoneda,
  soloDeTurnosAbiertos,
} from './efectivo-turno.util';
import { Types } from 'mongoose';
import { MetodoPagoReporte } from './schema/reporte_plus.schema';

describe('monedaDelPago', () => {
  it('devuelve CUP cuando el pago no trae moneda', () => {
    expect(monedaDelPago({})).toBe(MONEDA_POR_DEFECTO);
    expect(monedaDelPago(null)).toBe('CUP');
    expect(monedaDelPago(undefined)).toBe('CUP');
  });

  it('devuelve la moneda del pago cuando existe', () => {
    expect(monedaDelPago({ moneda: 'USD' })).toBe('USD');
  });

  it('un id de Moneda sin traducir se trata como CUP (el monto de la venta ya está en CUP)', () => {
    expect(monedaDelPago({ moneda: '507f1f77bcf86cd799439011' })).toBe('CUP');
    expect(monedaDelPago({ moneda: new Types.ObjectId() })).toBe('CUP');
  });
});

describe('calcularEfectivoEsperado', () => {
  it('fondo inicial + entradas físicas - salidas físicas', () => {
    expect(
      calcularEfectivoEsperado({
        fondoInicial: 1000,
        efectivoRecibido: 500,
        cambioEntregado: 20,
        devolucionesEfectivo: 30,
        extracciones: 100,
        depositosBancarios: 200,
      }),
    ).toBe(1150);
  });

  it('los campos omitidos cuentan como 0 y redondea a 2 decimales', () => {
    expect(
      calcularEfectivoEsperado({ fondoInicial: 0.1, efectivoRecibido: 0.2 }),
    ).toBe(0.3);
  });
});

describe('resumirPorMoneda', () => {
  const fila = (
    metodoPago: MetodoPagoReporte,
    total: number,
    moneda?: string,
  ) => ({ metodoPago, total, moneda });

  it('separa efectivo, cuentas por cobrar y cobros electrónicos y nunca suma monedas distintas', () => {
    const r = resumirPorMoneda({
      fondoInicial: { CUP: 1000, USD: 50 },
      filas: [
        fila(MetodoPagoReporte.EFECTIVO, 300),
        fila(MetodoPagoReporte.EFECTIVO, 20, 'USD'),
        fila(MetodoPagoReporte.CREDITO, 500),
        fila(MetodoPagoReporte.TRANSFERENCIA, 70),
        fila(MetodoPagoReporte.FACTURA, 900),
      ],
      extracciones: [{ monto: 100 }, { monto: 5, moneda: 'USD' }],
      depositos: [{ monto: 200 }],
    });

    expect(r.efectivoEsperado).toEqual({ CUP: 1000, USD: 65 });
    // 1000 + 300 - 100 - 200 = 1000 (el crédito, la transferencia y la factura no entran)
    expect(r.cuentasPorCobrar).toEqual({ CUP: 500, USD: 0 });
    expect(r.cobrosElectronicos).toEqual({ CUP: 70, USD: 0 });
    expect(r.facturado).toEqual({ CUP: 900, USD: 0 });
    expect(r.detalleEfectivo.CUP).toEqual({
      fondoInicial: 1000,
      efectivoRecibido: 300,
      cambioEntregado: 0,
      devolucionesEfectivo: 0,
      extracciones: 100,
      depositosBancarios: 200,
      efectivoEsperado: 1000,
    });
  });

  it('una venta a crédito no cambia el efectivo esperado', () => {
    const base = {
      fondoInicial: { CUP: 100 },
      extracciones: [],
      depositos: [],
    };
    const sin = resumirPorMoneda({
      ...base,
      filas: [fila(MetodoPagoReporte.EFECTIVO, 40)],
    });
    const con = resumirPorMoneda({
      ...base,
      filas: [
        fila(MetodoPagoReporte.EFECTIVO, 40),
        fila(MetodoPagoReporte.CREDITO, 999),
      ],
    });
    expect(con.efectivoEsperado).toEqual(sin.efectivoEsperado);
    expect(con.cuentasPorCobrar.CUP).toBe(999);
  });

  it('cuentas por cobrar = ventas a crédito - cobros aplicados', () => {
    const r = resumirPorMoneda({
      fondoInicial: {},
      filas: [fila(MetodoPagoReporte.CREDITO, 500)],
      extracciones: [],
      depositos: [],
      cobrosAplicados: [{ monto: 120 }],
    });
    expect(r.cuentasPorCobrar.CUP).toBe(380);
  });

  it('sin movimientos informa CUP en 0', () => {
    const r = resumirPorMoneda({
      fondoInicial: {},
      filas: [],
      extracciones: [],
      depositos: [],
    });
    expect(r.efectivoEsperado).toEqual({ CUP: 0 });
  });
});

describe('soloDeTurnosAbiertos', () => {
  const abierto = new Types.ObjectId();
  const cerrado = new Types.ObjectId();
  const abiertos = new Set([String(abierto)]);
  const turnoDe = (m: { id: number; turno?: unknown }): unknown => m.turno;

  it('conserva lo de un turno abierto (ObjectId o texto) y lo que no tiene turno', () => {
    const movimientos = [
      { id: 1, turno: abierto },
      { id: 2, turno: String(abierto) },
      { id: 3 },
      { id: 4, turno: null },
    ];

    expect(
      soloDeTurnosAbiertos(movimientos, turnoDe, abiertos).map((m) => m.id),
    ).toEqual([1, 2, 3, 4]);
  });

  it('descarta lo de un turno cerrado o desconocido', () => {
    const movimientos = [
      { id: 1, turno: cerrado },
      { id: 2, turno: new Types.ObjectId() },
      { id: 3, turno: abierto },
    ];

    expect(
      soloDeTurnosAbiertos(movimientos, turnoDe, abiertos).map((m) => m.id),
    ).toEqual([3]);
  });

  it('sin turnos abiertos solo quedan los movimientos sin turno', () => {
    expect(
      soloDeTurnosAbiertos(
        [{ id: 1, turno: abierto }, { id: 2 }],
        turnoDe,
        new Set<string>(),
      ).map((m) => m.id),
    ).toEqual([2]);
  });
});
