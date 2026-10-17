import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/pushNotification.service.js', () => ({
  notifyRoles: vi.fn().mockResolvedValue({ sent: 1 }),
}));

import { formsWebhookHandler } from '../../handlers/formsWebhook.handler.js';
import { notifyRoles } from '../../../../services/pushNotification.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const SECRET = 'test-secret';

describe('formsWebhookHandler', () => {
  beforeEach(() => {
    process.env.FORMS_WEBHOOK_SECRET = SECRET;
    process.env.DEFAULT_CLUB_ID = 'CARC';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.FORMS_WEBHOOK_SECRET;
  });

  it('should return 401 when the secret is missing or wrong', async () => {
    const req = { headers: {}, body: { tipo: 'socio', nombre: 'Juan' } };
    const res = mockRes();

    await formsWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(notifyRoles).not.toHaveBeenCalled();
  });

  it('should return 400 when tipo is invalid', async () => {
    const req = { headers: { 'x-webhook-secret': SECRET }, body: { tipo: 'invalido', nombre: 'Juan' } };
    const res = mockRes();

    await formsWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when nombre is missing', async () => {
    const req = { headers: { 'x-webhook-secret': SECRET }, body: { tipo: 'socio' } };
    const res = mockRes();

    await formsWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should notify autoridad and secretaria on a valid request', async () => {
    const req = { headers: { 'x-webhook-secret': SECRET }, body: { tipo: 'viaje', nombre: 'Juan Pérez' } };
    const res = mockRes();

    await formsWebhookHandler(req, res);

    expect(notifyRoles).toHaveBeenCalledWith(
      'CARC',
      ['autoridad', 'secretaria'],
      expect.objectContaining({ body: expect.stringContaining('Juan Pérez') }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 500 on unexpected error', async () => {
    notifyRoles.mockRejectedValueOnce(new Error('push down'));
    const req = { headers: { 'x-webhook-secret': SECRET }, body: { tipo: 'socio', nombre: 'Juan' } };
    const res = mockRes();

    await formsWebhookHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
