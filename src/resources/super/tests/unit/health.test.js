import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHealthHandler } from '../../handlers/getHealth.handler.js';
import mongoose from 'mongoose';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json   = vi.fn(() => res);
  return res;
};

describe('Super — health handler (unit)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('devuelve status ok con uptime y mongoStatus', async () => {
    vi.spyOn(mongoose, 'connection', 'get').mockReturnValue({ readyState: 1 });

    const req = {};
    const res = mockRes();
    await getHealthHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      mongoStatus: 'connected',
      jobs: expect.arrayContaining(['syncSheets', 'syncInstagram', 'recordatorioCuotas']),
    }));
  });
});
