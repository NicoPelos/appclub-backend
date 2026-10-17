import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteRolHandler } from '../../handlers/deleteRol.handler.js';

vi.mock('../../models/Rol.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../../usuarios/models/User.js', () => ({ default: { exists: vi.fn() } }));
vi.mock('../../../services/permisosCache.js', () => ({ invalidarClub: vi.fn() }));

import Rol from '../../models/Rol.js';
import User from '../../../usuarios/models/User.js';

const mockUser = { clubId: 'CARC' };
const VALID_ID = '507f1f77bcf86cd799439011';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  User.exists.mockResolvedValue(null);
});

describe('deleteRolHandler', () => {
  it('desactiva el rol correctamente (200)', async () => {
    const rol = { slug: 'profesor', nombre: 'Profesor', active: true, save: vi.fn().mockResolvedValue() };
    Rol.findOne.mockResolvedValue(rol);

    const req = { user: mockUser, params: { id: VALID_ID } };
    const res = mockRes();
    await deleteRolHandler(req, res);

    expect(rol.active).toBe(false);
    expect(rol.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Rol eliminado' });
  });

  it('retorna 404 si el rol no existe', async () => {
    Rol.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: 'noexiste' } };
    const res = mockRes();
    await deleteRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error de BD', async () => {
    Rol.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: VALID_ID } };
    const res = mockRes();
    await deleteRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it.each(['socio', 'admin'])('appcarc-backend#225: retorna 409 si el rol es el protegido "%s", sin llegar a guardar', async (slug) => {
    const rol = { slug, nombre: slug, active: true, save: vi.fn() };
    Rol.findOne.mockResolvedValue(rol);

    const req = { user: mockUser, params: { id: VALID_ID } };
    const res = mockRes();
    await deleteRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(rol.save).not.toHaveBeenCalled();
    expect(User.exists).not.toHaveBeenCalled();
  });

  it('appcarc-backend#225: retorna 409 si el rol todavía tiene usuarios asignados', async () => {
    const rol = { slug: 'profesor', nombre: 'Profesor', active: true, save: vi.fn() };
    Rol.findOne.mockResolvedValue(rol);
    User.exists.mockResolvedValue({ _id: 'user1' });

    const req = { user: mockUser, params: { id: VALID_ID } };
    const res = mockRes();
    await deleteRolHandler(req, res);

    expect(User.exists).toHaveBeenCalledWith({ clubId: 'CARC', roles: rol._id });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(rol.save).not.toHaveBeenCalled();
  });

  it('appcarc-backend#227: devuelve 404 (no 500) si el :id no es un ObjectId válido', async () => {
    const req = { user: mockUser, params: { id: 'no-es-un-id' } };
    const res = mockRes();
    await deleteRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(Rol.findOne).not.toHaveBeenCalled();
  });
});
