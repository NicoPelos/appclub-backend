import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../clubs/models/Club.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../novedades/models/InstagramConfig.js', () => ({
  default: { distinct: vi.fn() },
}));
vi.mock('../../../novedades/services/syncInstagram.service.js', () => ({
  syncInstagramFeed: vi.fn(),
}));
vi.mock('../../../../services/sheetsExport.service.js', () => ({
  exportToSheets: vi.fn(),
}));
vi.mock('../../../../jobs/recordatorioCuotas.job.js', () => ({
  enviarRecordatorios: vi.fn().mockResolvedValue(undefined),
}));

import { runJobHandler } from '../../handlers/runJob.handler.js';
import Club from '../../../clubs/models/Club.js';
import InstagramConfig from '../../../novedades/models/InstagramConfig.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  Club.find.mockResolvedValue([]);
  InstagramConfig.distinct.mockResolvedValue([]);
});

describe('runJobHandler', () => {
  it('ejecuta un job real (recordatorioCuotas) y responde 200', async () => {
    const req = { params: { nombre: 'recordatorioCuotas' } };
    const res = mockRes();
    await runJobHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('devuelve 400 para un job que no existe', async () => {
    const req = { params: { nombre: 'jobInventado' } };
    const res = mockRes();
    await runJobHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it.each(['constructor', 'hasOwnProperty', 'toString', 'valueOf', '__proto__'])(
    'appcarc-backend#204: devuelve 400 (no 200 ni 500) para el nombre heredado de Object.prototype "%s"',
    async (nombre) => {
      const req = { params: { nombre } };
      const res = mockRes();
      await runJobHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('no existe') }));
    },
  );
});
