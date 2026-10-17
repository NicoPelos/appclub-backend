import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../audit/models/AuditLog.js', () => ({
  default: { find: vi.fn(), countDocuments: vi.fn() },
}));

import { getSuperAuditHandler } from '../../handlers/getSuperAudit.handler.js';
import AuditLog from '../../../audit/models/AuditLog.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const makeQuery = (result = []) => ({
  sort: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

beforeEach(() => {
  vi.clearAllMocks();
  AuditLog.countDocuments.mockResolvedValue(0);
  AuditLog.find.mockReturnValue(makeQuery([]));
});

describe('getSuperAuditHandler', () => {
  it('sin filtros, devuelve lista paginada', async () => {
    const req = { query: {} };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(AuditLog.find.mock.calls[0][0]).toEqual({});
  });

  it('reverted=false filtra revertedAt: null (papelera vigente)', async () => {
    const req = { query: { reverted: 'false' } };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(AuditLog.find.mock.calls[0][0]).toEqual({ revertedAt: null });
  });

  it('reverted=true filtra revertedAt: { $ne: null } (ya restaurado)', async () => {
    const req = { query: { reverted: 'true' } };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(AuditLog.find.mock.calls[0][0]).toEqual({ revertedAt: { $ne: null } });
  });

  it('combina reverted con action y clubId', async () => {
    const req = { query: { action: 'DELETE', clubId: 'CARC', reverted: 'false' } };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(AuditLog.find.mock.calls[0][0]).toEqual({ action: 'DELETE', clubId: 'CARC', revertedAt: null });
  });

  it('ignora reverted con valor inválido', async () => {
    const req = { query: { reverted: 'maybe' } };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(AuditLog.find.mock.calls[0][0]).toEqual({});
  });

  it('filtra createdAt con from/to válidos (YYYY-MM)', async () => {
    const req = { query: { from: '2026-01', to: '2026-03' } };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(AuditLog.find.mock.calls[0][0]).toEqual({
      createdAt: { $gte: new Date('2026-01-01T00:00:00.000Z'), $lt: new Date('2026-04-01T00:00:00.000Z') },
    });
  });

  it.each(['abc', '2026', '2026-13', '2026-1'])(
    'appcarc-backend#205: devuelve 400 (no 500) con from="%s" mal formado',
    async (from) => {
      const req = { query: { from } };
      const res = mockRes();
      await getSuperAuditHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(AuditLog.find).not.toHaveBeenCalled();
    },
  );

  it('appcarc-backend#205: devuelve 400 con to mal formado', async () => {
    const req = { query: { to: 'abc' } };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 si hay error inesperado', async () => {
    AuditLog.countDocuments.mockRejectedValue(new Error('DB error'));
    const req = { query: {} };
    const res = mockRes();
    await getSuperAuditHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
