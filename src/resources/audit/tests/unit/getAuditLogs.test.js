import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../models/AuditLog.js', () => ({
  default: {
    countDocuments: vi.fn(),
    find: vi.fn(),
  },
}));

import { getAuditLogsHandler } from '../../handlers/getAuditLogs.handler.js';
import AuditLog from '../../models/AuditLog.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const USER = { id: '507f1f77bcf86cd799439011', email: 'admin@test.com', clubId: 'club1' };

const mockFindChain = (logs) => {
  const chain = { sort: vi.fn(), skip: vi.fn(), limit: vi.fn(), lean: vi.fn() };
  chain.sort.mockReturnValue(chain);
  chain.skip.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.lean.mockResolvedValue(logs);
  AuditLog.find.mockReturnValue(chain);
};

describe('getAuditLogsHandler', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('devuelve logs paginados sin filtros', async () => {
    const fakeLogs = [{ _id: '1', action: 'CREATE', resource: 'Socio' }];
    AuditLog.countDocuments.mockResolvedValue(1);
    mockFindChain(fakeLogs);

    const req = { user: USER, query: {} };
    const res = mockRes();
    await getAuditLogsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ page: 1, limit: 50, total: 1, logs: fakeLogs });
    expect(AuditLog.find).toHaveBeenCalledWith({ clubId: 'club1' });
  });

  it('aplica filtros resource, userId y action', async () => {
    AuditLog.countDocuments.mockResolvedValue(0);
    mockFindChain([]);

    const validUserId = '507f1f77bcf86cd799439022';
    const req = { user: USER, query: { resource: 'Cobro', userId: validUserId, action: 'DELETE' } };
    await getAuditLogsHandler(req, mockRes());

    expect(AuditLog.find).toHaveBeenCalledWith(expect.objectContaining({
      resource: 'Cobro',
      userId: validUserId,
      action: 'DELETE',
    }));
  });

  it.each(['abc', '123'])(
    'appcarc-backend#223: devuelve 400 (no 500) con userId "%s" mal formado',
    async (userId) => {
      const req = { user: USER, query: { userId } };
      const res = mockRes();
      await getAuditLogsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(AuditLog.find).not.toHaveBeenCalled();
    },
  );

  it('appcarc-backend#223: devuelve 400 si resource no es un string (operator injection)', async () => {
    const req = { user: USER, query: { resource: { $ne: 'Socio' } } };
    const res = mockRes();
    await getAuditLogsHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(AuditLog.find).not.toHaveBeenCalled();
  });

  it.each(['abc', '2026', '2026-13'])(
    'appcarc-backend#223: devuelve 400 (no 500) con from="%s" mal formado',
    async (from) => {
      const req = { user: USER, query: { from } };
      const res = mockRes();
      await getAuditLogsHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(AuditLog.find).not.toHaveBeenCalled();
    },
  );

  it('aplica filtro de rango de fechas con from y to', async () => {
    AuditLog.countDocuments.mockResolvedValue(0);
    mockFindChain([]);

    const req = { user: USER, query: { from: '2026-01', to: '2026-03' } };
    await getAuditLogsHandler(req, mockRes());

    const filter = AuditLog.find.mock.calls[0][0];
    expect(filter.createdAt.$gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(filter.createdAt.$lt).toEqual(new Date('2026-04-01T00:00:00.000Z'));
  });

  it('ignora action inválido', async () => {
    AuditLog.countDocuments.mockResolvedValue(0);
    mockFindChain([]);

    const req = { user: USER, query: { action: 'HACK' } };
    await getAuditLogsHandler(req, mockRes());

    const filter = AuditLog.find.mock.calls[0][0];
    expect(filter.action).toBeUndefined();
  });

  it('devuelve 500 si falla la BD', async () => {
    AuditLog.countDocuments.mockRejectedValue(new Error('connection reset'));
    mockFindChain([]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mockRes();
    await getAuditLogsHandler({ user: USER, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});
