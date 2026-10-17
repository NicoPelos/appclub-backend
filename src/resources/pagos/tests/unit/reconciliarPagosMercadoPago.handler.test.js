import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/MercadoPagoConfig.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../services/reconciliarPagosMercadoPago.service.js', () => ({
  reconciliarPagosMercadoPagoClub: vi.fn(),
}));

import MercadoPagoConfig from '../../models/MercadoPagoConfig.js';
import { reconciliarPagosMercadoPagoClub } from '../../services/reconciliarPagosMercadoPago.service.js';
import { reconciliarPagosMercadoPagoHandler } from '../../handlers/reconciliarPagosMercadoPago.handler.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('reconciliarPagosMercadoPagoHandler', () => {
  it('revisa los pagos pendientes del club del usuario logueado', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue({ clubId: 'CARC', accessToken: 'token-carc', active: true });
    reconciliarPagosMercadoPagoClub.mockResolvedValue({ revisados: 3, resueltos: 1, errores: 0, expirados: 2 });

    const req = { user: { clubId: 'CARC' } };
    const res = mockRes();

    await reconciliarPagosMercadoPagoHandler(req, res);

    expect(MercadoPagoConfig.findOne).toHaveBeenCalledWith({ clubId: 'CARC', active: true });
    expect(reconciliarPagosMercadoPagoClub).toHaveBeenCalledWith({ clubId: 'CARC', accessToken: 'token-carc' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ revisados: 3, resueltos: 1, errores: 0, expirados: 2 });
  });

  it('responde 400 si el club no tiene Mercado Pago configurado', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue(null);

    const req = { user: { clubId: 'CARC' } };
    const res = mockRes();

    await reconciliarPagosMercadoPagoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(reconciliarPagosMercadoPagoClub).not.toHaveBeenCalled();
  });

  it('responde 500 si la reconciliación falla', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue({ clubId: 'CARC', accessToken: 'token-carc' });
    reconciliarPagosMercadoPagoClub.mockRejectedValue(new Error('boom'));

    const req = { user: { clubId: 'CARC' } };
    const res = mockRes();

    await reconciliarPagosMercadoPagoHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
