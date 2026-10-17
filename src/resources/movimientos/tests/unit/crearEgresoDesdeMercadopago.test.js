import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearEgresoDesdeMercadopagoHandler } from '../../handlers/mercadopagoSinVincular.handler.js';
import Movimiento from '../../models/Movimiento.js';
import MercadoPagoConfig from '../../../pagos/models/MercadoPagoConfig.js';
import { obtenerPagoMercadoPago } from '../../../pagos/services/procesarPagoMercadoPago.service.js';

vi.mock('../../../pagos/services/procesarPagoMercadoPago.service.js', () => ({
  obtenerPagoMercadoPago: vi.fn(),
}));

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };
const BASE_BODY = { concept: 'Compra de material', categoria: 'Varios', responsable: 'Secretaría' };

const PAGO_APROBADO = {
  id: 999,
  status: 'approved',
  transaction_amount: 100000,
  transaction_details: { total_paid_amount: 100600 },
  collector: { email: 'proveedor@test.com' },
  date_approved: '2026-09-02T18:00:00.000Z',
};

describe('crearEgresoDesdeMercadopagoHandler', () => {
  let saveSpy;

  beforeEach(() => {
    saveSpy = vi.spyOn(Movimiento.prototype, 'save').mockImplementation(async function () { return this; });
    Movimiento.findOne = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    MercadoPagoConfig.findOne = vi.fn().mockResolvedValue({ accessToken: 'token' });
    obtenerPagoMercadoPago.mockResolvedValue({ ok: true, payment: PAGO_APROBADO });
  });

  afterEach(() => vi.restoreAllMocks());

  it('should return 400 when concept is missing', async () => {
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: { ...BASE_BODY, concept: '' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('should return 400 when categoria is not valid for Egreso', async () => {
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: { ...BASE_BODY, categoria: 'Viajes' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when responsable is missing', async () => {
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: { ...BASE_BODY, responsable: '' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when the club has no Mercado Pago config', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue(null);
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: BASE_BODY, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when the payment is not approved', async () => {
    obtenerPagoMercadoPago.mockResolvedValue({ ok: true, payment: { ...PAGO_APROBADO, status: 'pending' } });
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: BASE_BODY, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('should return 409 when the payment is already linked to another movimiento', async () => {
    Movimiento.findOne = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'otro-mov' }) }) });
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: BASE_BODY, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('should create the Movimiento using transaction_amount (lo que recibió el otro) and vincularlo en el mismo paso', async () => {
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: BASE_BODY, user: USER }, res);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
    const [movimiento] = res.json.mock.calls[0];
    expect(movimiento).toMatchObject({
      type: 'Egreso',
      amount: 100000,
      concept: 'Compra de material',
      categoria: 'Varios',
      paymentMethod: 'MercadoPago',
    });
    expect(movimiento.description).toContain('Comisión de Mercado Pago: $600.00');
    expect(movimiento.mercadopagoVinculos).toEqual([
      expect.objectContaining({ paymentId: '999', payerEmail: 'proveedor@test.com', monto: 100000 }),
    ]);
  });

  it('should not mention a fee when total_paid_amount is missing', async () => {
    obtenerPagoMercadoPago.mockResolvedValue({
      ok: true,
      payment: { ...PAGO_APROBADO, transaction_details: undefined },
    });
    const res = mockRes();
    await crearEgresoDesdeMercadopagoHandler({ params: { paymentId: '999' }, body: BASE_BODY, user: USER }, res);

    const [movimiento] = res.json.mock.calls[0];
    expect(movimiento.amount).toBe(100000);
    expect(movimiento.description).not.toContain('Comisión');
  });
});
