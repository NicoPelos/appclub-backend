import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../roles/services/resolverRoles.service.js', () => ({
  obtenerRolIdsPorNombres: vi.fn().mockResolvedValue(['rol-id-1']),
}));
vi.mock('../../../vinculos/services/anularVinculosFamiliares.service.js', () => ({ anularVinculosFamiliares: vi.fn().mockResolvedValue() }));

vi.mock('../../../clubs/models/Club.js', () => ({
  default: { exists: vi.fn().mockResolvedValue({ _id: 'c1' }) },
}));

vi.mock('../../../socios/models/Socio.js', () => ({
  default: { find: vi.fn() },
}));

import { getUsersHandler }        from '../../handlers/getUsers.handler.js';
import { createSuperUserHandler } from '../../handlers/createSuperUser.handler.js';
import { deleteSuperUserHandler } from '../../handlers/deleteSuperUser.handler.js';
import Club from '../../../clubs/models/Club.js';
import { resetUserPasswordHandler } from '../../handlers/resetUserPassword.handler.js';
import User from '../../../usuarios/models/User.js';
import Socio from '../../../socios/models/Socio.js';
import bcrypt from 'bcryptjs';
import { obtenerRolIdsPorNombres } from '../../../roles/services/resolverRoles.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json   = vi.fn(() => res);
  return res;
};

describe('Super — users handlers (unit)', () => {
  beforeEach(() => {
    User.countDocuments    = vi.fn().mockResolvedValue(5);
    User.find              = vi.fn();
    User.findOne           = vi.fn();
    User.findByIdAndUpdate = vi.fn();
    User.findById          = vi.fn();
    User.create            = vi.fn();
    vi.spyOn(bcrypt, 'genSalt').mockResolvedValue('salt');
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('hashed');
    obtenerRolIdsPorNombres.mockResolvedValue(['rol-id-1']);
    Socio.find = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue([]) });
  });

  afterEach(() => vi.clearAllMocks());

  it('getUsersHandler devuelve lista paginada', async () => {
    const fakeUsers = [{ _id: 'u1', email: 'a@b.com' }];
    const query = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      sort:   vi.fn().mockReturnThis(),
      skip:   vi.fn().mockReturnThis(),
      limit:  vi.fn().mockReturnThis(),
      lean:   vi.fn().mockResolvedValue(fakeUsers),
    };
    User.find.mockReturnValue(query);

    const req = { query: {} };
    const res = mockRes();
    await getUsersHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 5 }));
  });

  it('getUsersHandler filtra por search (nombre o email)', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      sort:   vi.fn().mockReturnThis(),
      skip:   vi.fn().mockReturnThis(),
      limit:  vi.fn().mockReturnThis(),
      lean:   vi.fn().mockResolvedValue([]),
    };
    User.find.mockReturnValue(query);

    const req = { query: { search: 'ana' } };
    const res = mockRes();
    await getUsersHandler(req, res);

    const filterArg = User.find.mock.calls[0][0];
    expect(filterArg.$or).toHaveLength(2);
    expect(filterArg.$or[0].nombre.test('Ana García')).toBe(true);
    expect(filterArg.$or[1].email.test('ana@carc.com')).toBe(true);
  });

  it('getUsersHandler escapa caracteres especiales de regex en search', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      sort:   vi.fn().mockReturnThis(),
      skip:   vi.fn().mockReturnThis(),
      limit:  vi.fn().mockReturnThis(),
      lean:   vi.fn().mockResolvedValue([]),
    };
    User.find.mockReturnValue(query);

    const req = { query: { search: '(test)' } };
    const res = mockRes();
    await getUsersHandler(req, res);

    const filterArg = User.find.mock.calls[0][0];
    expect(filterArg.$or[0].nombre.test('(test)')).toBe(true);
    expect(filterArg.$or[0].nombre.test('test')).toBe(false);
  });

  it('getUsersHandler suma socioId por DNI cuando el search son solo dígitos', async () => {
    Socio.find.mockReturnValue({ select: vi.fn().mockResolvedValue([{ _id: 'socio1' }, { _id: 'socio2' }]) });
    const query = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      sort:   vi.fn().mockReturnThis(),
      skip:   vi.fn().mockReturnThis(),
      limit:  vi.fn().mockReturnThis(),
      lean:   vi.fn().mockResolvedValue([]),
    };
    User.find.mockReturnValue(query);

    const req = { query: { search: '30123456', clubId: 'CARC' } };
    const res = mockRes();
    await getUsersHandler(req, res);

    expect(Socio.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC' }));
    const filterArg = User.find.mock.calls[0][0];
    expect(filterArg.$or).toHaveLength(3);
    expect(filterArg.$or[2]).toEqual({ socioId: { $in: ['socio1', 'socio2'] } });
  });

  it('getUsersHandler no suma cláusula de DNI si search no son solo dígitos', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      sort:   vi.fn().mockReturnThis(),
      skip:   vi.fn().mockReturnThis(),
      limit:  vi.fn().mockReturnThis(),
      lean:   vi.fn().mockResolvedValue([]),
    };
    User.find.mockReturnValue(query);

    const req = { query: { search: 'ana30' } };
    const res = mockRes();
    await getUsersHandler(req, res);

    expect(Socio.find).not.toHaveBeenCalled();
    const filterArg = User.find.mock.calls[0][0];
    expect(filterArg.$or).toHaveLength(2);
  });

  it('createSuperUserHandler devuelve 400 si falta email', async () => {
    const req = { body: { clubId: 'CARC' } };
    const res = mockRes();
    await createSuperUserHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createSuperUserHandler rechaza un clubId que no existe (appcarc-backend#240)', async () => {
    Club.exists.mockResolvedValueOnce(null);
    const req = { body: { email: 'a@b.com', clubId: 'NOEXISTE' } };
    const res = mockRes();
    await createSuperUserHandler(req, res);
    expect(User.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createSuperUserHandler crea usuario y devuelve tempPassword', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({ _id: 'u1', email: 'a@b.com', nombre: 'Test', roles: ['admin'], clubId: 'CARC' });
    const req = { body: { email: 'a@b.com', clubId: 'CARC', nombre: 'Test' } };
    const res = mockRes();
    await createSuperUserHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tempPassword: expect.any(String) }));
  });

  it('deleteSuperUserHandler desactiva usuario', async () => {
    User.findByIdAndUpdate.mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: 'u1', active: false }),
    });
    const req = { params: { id: 'u1' } };
    const res = mockRes();
    await deleteSuperUserHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('resetUserPasswordHandler resetea contraseña', async () => {
    const fakeUser = { _id: 'u1', password: 'old', mustChangePassword: false, passwordChangedAt: null, save: vi.fn() };
    User.findById.mockResolvedValue(fakeUser);
    const req = { params: { id: 'u1' } };
    const res = mockRes();
    await resetUserPasswordHandler(req, res);
    expect(fakeUser.mustChangePassword).toBe(true);
    expect(fakeUser.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ tempPassword: expect.any(String) }));
  });
});
