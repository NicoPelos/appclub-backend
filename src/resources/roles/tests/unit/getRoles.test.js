import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRolesHandler } from '../../handlers/getRoles.handler.js';

vi.mock('../../models/Rol.js', () => ({
  default: { find: vi.fn() },
}));

import Rol from '../../models/Rol.js';

const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('getRolesHandler', () => {
  it('retorna lista de roles activos (200)', async () => {
    const roles = [{ nombre: 'admin', permisos: ['socios:read'] }];
    Rol.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(roles) }) });

    const req = { user: mockUser };
    const res = mockRes();
    await getRolesHandler(req, res);

    expect(Rol.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(roles);
  });

  it('retorna 500 si hay error de BD', async () => {
    Rol.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB error')) }) });

    const req = { user: mockUser };
    const res = mockRes();
    await getRolesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
