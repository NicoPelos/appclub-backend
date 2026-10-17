import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conciliacionMercadopagoHandler } from '../../handlers/conciliacionMercadopago.handler.js';
import Movimiento from '../../models/Movimiento.js';
import MercadoPagoConfig from '../../../pagos/models/MercadoPagoConfig.js';
import { buscarPagosMercadoPago } from '../../../pagos/services/buscarPagosMercadoPago.service.js';

vi.mock('../../../pagos/services/buscarPagosMercadoPago.service.js', () => ({
  buscarPagosMercadoPago: vi.fn(),
}));

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { clubId: 'club1' };

const mockMovimientosFind = (result) => {
  Movimiento.find = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });
};

describe('conciliacionMercadopagoHandler', () => {
  beforeEach(() => {
    MercadoPagoConfig.findOne = vi.fn().mockResolvedValue({ accessToken: 'token' });
    buscarPagosMercadoPago.mockImplementation(({ direccion }) => Promise.resolve(direccion === 'egreso' ? [] : []));
    mockMovimientosFind([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('should return 400 when the club has no Mercado Pago config', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue(null);
    const res = mockRes();
    await conciliacionMercadopagoHandler({ user: USER, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should sum ingreso/egreso totals from MP and from Movimientos separately', async () => {
    buscarPagosMercadoPago.mockImplementation(({ direccion }) => Promise.resolve(
      direccion === 'egreso' ? [{ paymentId: 'e1', monto: 5000 }] : [{ paymentId: 'i1', monto: 10000 }, { paymentId: 'i2', monto: 3000 }],
    ));
    mockMovimientosFind([
      { _id: 'm1', type: 'Ingreso', amount: 10000, concept: 'Cobro', mercadopagoVinculos: [{ paymentId: 'i1', monto: 10000 }] },
      { _id: 'm2', type: 'Egreso', amount: 5000, concept: 'Pago proveedor', mercadopagoVinculos: [{ paymentId: 'e1', monto: 5000 }] },
    ]);

    const res = mockRes();
    await conciliacionMercadopagoHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.totales).toEqual({
      ingresoMp: 13000,
      ingresoMovimientos: 10000,
      egresoMp: 5000,
      egresoMovimientos: 5000,
    });
  });

  it('descuadresPago: flags when a single payment split across movimientos does not add up', async () => {
    mockMovimientosFind([
      { _id: 'm1', type: 'Ingreso', amount: 10000, concept: 'Cobro A', mercadopagoVinculos: [{ paymentId: 'p1', monto: 30000 }] },
      { _id: 'm2', type: 'Ingreso', amount: 15000, concept: 'Cobro B', mercadopagoVinculos: [{ paymentId: 'p1', monto: 30000 }] },
      // suma real: 10000 + 15000 = 25000, pero el pago real fue 30000 -> descuadre de 5000
    ]);

    const res = mockRes();
    await conciliacionMercadopagoHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.descuadresPago).toEqual([
      expect.objectContaining({ paymentId: 'p1', montoReal: 30000, sumaMovimientos: 25000, diferencia: -5000 }),
    ]);
  });

  it('descuadresPago: no flags when a single payment split across movimientos adds up exactly', async () => {
    mockMovimientosFind([
      { _id: 'm1', type: 'Ingreso', amount: 10000, concept: 'Cobro A', mercadopagoVinculos: [{ paymentId: 'p1', monto: 25000 }] },
      { _id: 'm2', type: 'Ingreso', amount: 15000, concept: 'Cobro B', mercadopagoVinculos: [{ paymentId: 'p1', monto: 25000 }] },
    ]);

    const res = mockRes();
    await conciliacionMercadopagoHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.descuadresPago).toEqual([]);
  });

  it('descuadresMovimiento: flags when a movimiento with several vinculos does not add up', async () => {
    mockMovimientosFind([
      {
        _id: 'm1',
        type: 'Ingreso',
        amount: 20000,
        concept: 'Cobro combinado',
        mercadopagoVinculos: [{ paymentId: 'p1', monto: 8000 }, { paymentId: 'p2', monto: 8000 }],
        // suma vinculos: 16000, monto del movimiento: 20000 -> descuadre de -4000
      },
    ]);

    const res = mockRes();
    await conciliacionMercadopagoHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.descuadresMovimiento).toEqual([
      expect.objectContaining({ movimientoId: 'm1', amount: 20000, sumaVinculos: 16000, diferencia: -4000 }),
    ]);
  });

  it('does not flag a movimiento with a single vinculo, even if it happens to differ from amount (no hay nada que sumar)', async () => {
    mockMovimientosFind([
      { _id: 'm1', type: 'Ingreso', amount: 20000, concept: 'Cobro', mercadopagoVinculos: [{ paymentId: 'p1', monto: 15000 }] },
    ]);

    const res = mockRes();
    await conciliacionMercadopagoHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.descuadresMovimiento).toEqual([]);
    expect(payload.descuadresPago).toEqual([]);
  });
});
