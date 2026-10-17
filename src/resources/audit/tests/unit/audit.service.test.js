import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../models/AuditLog.js', () => ({
  default: { create: vi.fn() },
}));

import { logAudit } from '../../services/audit.service.js';
import AuditLog from '../../models/AuditLog.js';

const mockReq = () => ({
  user: { id: '507f1f77bcf86cd799439011', email: 'admin@test.com', clubId: 'club1' },
  method: 'POST',
  originalUrl: '/api/socios',
  ip: '127.0.0.1',
  headers: {},
});

describe('logAudit', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('llama AuditLog.create con los campos correctos', async () => {
    AuditLog.create.mockResolvedValue({});
    const req = mockReq();

    await logAudit({ clubId: 'club1', req, action: 'CREATE', resource: 'Socio', resourceId: 'abc123', before: null, after: { nombre: 'Juan' } });

    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'club1',
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'CREATE',
      resource: 'Socio',
      resourceId: 'abc123',
      before: null,
      after: { nombre: 'Juan' },
      endpoint: 'POST /api/socios',
    }));
  });

  it('no propaga errores si AuditLog.create falla', async () => {
    AuditLog.create.mockRejectedValue(new Error('DB exploded'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      logAudit({ clubId: 'club1', req: mockReq(), action: 'DELETE', resource: 'Socio', resourceId: 'abc', before: {}, after: null })
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledWith('[AuditLog] Error guardando log:', 'DB exploded');
  });

  it('usa String(req.user.id) como userEmail si email no está disponible', async () => {
    AuditLog.create.mockResolvedValue({});
    const req = mockReq();
    delete req.user.email;

    await logAudit({ clubId: 'club1', req, action: 'UPDATE', resource: 'Socio', resourceId: '1', before: {}, after: {} });

    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      userEmail: String(req.user.id),
    }));
  });
});
