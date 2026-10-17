import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('../../../usuarios/models/User.js', () => ({
  default: { findById: vi.fn() },
}));

import { getMyProfileHandler } from '../../handlers/getMyProfile.handler.js';
import Socio from '../../models/Socio.js';
import User from '../../../usuarios/models/User.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('getMyProfileHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve 404 si el usuario no existe', async () => {
    User.findById.mockResolvedValue(null);
    const req = { user: { id: 'u1', clubId: 'CARC', socioId: 'socio1' } };
    const res = mockRes();
    await getMyProfileHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('devuelve el socio propio cuando el perfil activo coincide con el del usuario', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', email: 'a@b.com', nombre: 'Juan', clubId: 'CARC', socioId: 'socio1' });
    Socio.findOne.mockResolvedValue({ _id: 'socio1', nombre: 'Juan' });

    const req = { user: { id: 'u1', clubId: 'CARC', socioId: 'socio1' } };
    const res = mockRes();
    await getMyProfileHandler(req, res);

    expect(Socio.findOne).toHaveBeenCalledWith({ _id: 'socio1', clubId: 'CARC' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('usa el socioId del token (perfil activo), no el del User en la base, cuando está viendo un hijo vinculado', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', email: 'papa@b.com', nombre: 'Papá', clubId: 'CARC', socioId: 'socio-papa' });
    Socio.findOne.mockResolvedValue({ _id: 'socio-hijo', nombre: 'Hijo' });

    const req = { user: { id: 'u1', clubId: 'CARC', socioId: 'socio-hijo' } };
    const res = mockRes();
    await getMyProfileHandler(req, res);

    expect(Socio.findOne).toHaveBeenCalledWith({ _id: 'socio-hijo', clubId: 'CARC' });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      socio: expect.objectContaining({ _id: 'socio-hijo' }),
    }));
  });

  it('socio es null si el usuario no tiene ningún perfil activo (staff sin socio)', async () => {
    User.findById.mockResolvedValue({ _id: 'u1', email: 'staff@b.com', nombre: 'Staff', clubId: 'CARC', socioId: null });

    const req = { user: { id: 'u1', clubId: 'CARC', socioId: null } };
    const res = mockRes();
    await getMyProfileHandler(req, res);

    expect(Socio.findOne).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ socio: null }));
  });
});
