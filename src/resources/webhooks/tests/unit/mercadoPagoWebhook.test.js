import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../pagos/models/MercadoPagoConfig.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../pagos/models/PagoOnlineIntent.js', () => ({
  default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));
vi.mock('../../services/verifyMercadoPagoSignature.service.js', () => ({
  verifyMercadoPagoSignature: vi.fn(),
}));
vi.mock('../../../cobros/services/registrarCobro.service.js', () => ({
  registrarCobro: vi.fn(),
}));

import MercadoPagoConfig from '../../../pagos/models/MercadoPagoConfig.js';
import PagoOnlineIntent from '../../../pagos/models/PagoOnlineIntent.js';
import { verifyMercadoPagoSignature } from '../../services/verifyMercadoPagoSignature.service.js';
import { registrarCobro } from '../../../cobros/services/registrarCobro.service.js';
import { mercadoPagoWebhookHandler } from '../../handlers/mercadoPagoWebhook.handler.js';

const CLUB_ID = 'CARC';
const DATA_ID = '999';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseReq = (overrides = {}) => ({
  params: { clubId: CLUB_ID },
  body: { type: 'payment', data: { id: DATA_ID } },
  query: {},
  headers: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'req-1' },
  ...overrides,
});

const CONFIG = { clubId: CLUB_ID, accessToken: 'TEST-token', webhookSecret: 'secret' };

const buildIntent = (overrides = {}) => ({
  _id: 'intent-1',
  clubId: CLUB_ID,
  socioId: 'socio-1',
  requestedByUserId: 'user-1',
  requestedByEmail: 'socio@carc.test',
  items: [{ suscripcionId: 'sus-1', periodos: ['2026-06'] }],
  totalAmount: 15000,
  externalReference: 'ext-ref-1',
  estado: 'pendiente',
  save: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  MercadoPagoConfig.findOne = vi.fn().mockResolvedValue(CONFIG);
  verifyMercadoPagoSignature.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubPaymentFetch = (payment, ok = true) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: vi.fn().mockResolvedValue(payment),
  }));
};

describe('mercadoPagoWebhookHandler', () => {
  it('ignora notificaciones que no son de tipo payment', async () => {
    const req = baseReq({ body: { type: 'merchant_order', data: { id: DATA_ID } } });
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(MercadoPagoConfig.findOne).not.toHaveBeenCalled();
  });

  it('responde 200 sin hacer nada si no hay dataId', async () => {
    const req = baseReq({ body: { type: 'payment', data: {} } });
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(MercadoPagoConfig.findOne).not.toHaveBeenCalled();
  });

  it('appcarc-backend#214: ignora un dataId no numérico sin llegar a pedir la config del club', async () => {
    const req = baseReq({ body: { type: 'payment', data: { id: '1/../../v1/account/settings' } } });
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ignored: true }));
    expect(MercadoPagoConfig.findOne).not.toHaveBeenCalled();
  });

  it('retorna 401 si el club no tiene Mercado Pago configurado', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue(null);
    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(verifyMercadoPagoSignature).not.toHaveBeenCalled();
  });

  it('retorna 401 si la firma es inválida, sin tocar nada más', async () => {
    verifyMercadoPagoSignature.mockReturnValue(false);
    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(PagoOnlineIntent.findOne).not.toHaveBeenCalled();
  });

  it('con firma OK pero MP payment fetch falla, responde con error para que MP reintente', async () => {
    stubPaymentFetch({}, false);
    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retry: true }));
  });

  it('ante una excepción no controlada, responde con error para que MP reintente', async () => {
    verifyMercadoPagoSignature.mockImplementation(() => { throw new Error('boom'); });
    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('pago aprobado: transiciona el intent y llama registrarCobro', async () => {
    const intent = buildIntent();
    stubPaymentFetch({ status: 'approved', status_detail: 'accredited', transaction_amount: 15000, external_reference: 'ext-ref-1' });
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
    registrarCobro.mockResolvedValue({ cobro: { _id: 'cobro-1' } });

    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(registrarCobro).toHaveBeenCalledWith(expect.objectContaining({
      clubId: CLUB_ID,
      user: { id: 'user-1', email: 'socio@carc.test' },
      body: expect.objectContaining({ paymentMethod: 'MercadoPago' }),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reintento duplicado de MP (intent ya no está pendiente): no reprocesa', async () => {
    const intent = buildIntent();
    stubPaymentFetch({ status: 'approved', transaction_amount: 15000, external_reference: 'ext-ref-1' });
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue(null); // ya no matchea estado:'pendiente'

    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(registrarCobro).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true }));
  });

  it('monto no coincide: marca rechazado y no llama registrarCobro', async () => {
    const intent = buildIntent({ totalAmount: 15000 });
    stubPaymentFetch({ status: 'approved', transaction_amount: 999, external_reference: 'ext-ref-1' });
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'rechazado' });

    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(registrarCobro).not.toHaveBeenCalled();
    expect(PagoOnlineIntent.findOneAndUpdate).toHaveBeenCalledWith(
      // appcarc-backend#257: el guard ahora también acepta 'rechazado' como
      // estado previo (ver procesarPagoMercadoPago.service.js).
      expect.objectContaining({ _id: intent._id, estado: { $in: ['pendiente', 'rechazado'] } }),
      expect.objectContaining({ $set: expect.objectContaining({ estado: 'rechazado' }) }),
    );
  });

  it('no encuentra el intent para el external_reference: ignora sin error', async () => {
    stubPaymentFetch({ status: 'approved', transaction_amount: 15000, external_reference: 'no-existe' });
    PagoOnlineIntent.findOne.mockResolvedValue(null);

    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(registrarCobro).not.toHaveBeenCalled();
  });

  it('IPN (sin x-signature, topic/id en query): no exige firma y procesa igual', async () => {
    const intent = buildIntent();
    stubPaymentFetch({ status: 'approved', transaction_amount: 15000, external_reference: 'ext-ref-1' });
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue({ ...intent, estado: 'aprobado' });
    registrarCobro.mockResolvedValue({ cobro: { _id: 'cobro-1' } });

    const req = baseReq({ body: {}, query: { topic: 'payment', id: DATA_ID }, headers: {} });
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(verifyMercadoPagoSignature).not.toHaveBeenCalled();
    expect(registrarCobro).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('IPN con topic distinto de payment: ignora sin pedir el club', async () => {
    const req = baseReq({ body: {}, query: { topic: 'merchant_order', id: DATA_ID }, headers: {} });
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(MercadoPagoConfig.findOne).not.toHaveBeenCalled();
  });

  it('si registrarCobro falla (conflicto de negocio), igual responde 200 y deja el intent aprobado sin cobroId', async () => {
    const intent = buildIntent();
    const updatedIntent = buildIntent({ estado: 'aprobado' });
    stubPaymentFetch({ status: 'approved', transaction_amount: 15000, external_reference: 'ext-ref-1' });
    PagoOnlineIntent.findOne.mockResolvedValue(intent);
    PagoOnlineIntent.findOneAndUpdate.mockResolvedValue(updatedIntent);
    registrarCobro.mockRejectedValue(new Error('La cuota ya está pagada'));

    const req = baseReq();
    const res = mockRes();

    await mercadoPagoWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(updatedIntent.save).not.toHaveBeenCalled();
  });
});
