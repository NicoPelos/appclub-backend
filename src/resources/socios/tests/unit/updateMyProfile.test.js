import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/socioSheetSync.js', () => ({
  syncSocioToSheet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../models/Socio.js', () => ({
  default: { findOne: vi.fn(), findOneAndUpdate: vi.fn() },
}));

vi.mock('../../../usuarios/models/User.js', () => ({
  default: { findById: vi.fn(), findOne: vi.fn() },
}));

import { updateMyProfileHandler } from '../../handlers/updateMyProfile.handler.js';
import Socio from '../../models/Socio.js';
import User from '../../../usuarios/models/User.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildUser = (overrides = {}) => ({
  _id: 'u1',
  socioId: 'socio1',
  clubId: 'CARC',
  email: 'viejo@test.com',
  nombre: 'Juan',
  save: vi.fn().mockResolvedValue(true),
  ...overrides,
});

describe('updateMyProfileHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devuelve 400 si el usuario no tiene socio vinculado', async () => {
    User.findById.mockResolvedValue(buildUser({ socioId: null }));
    const req = { body: {}, user: { id: 'u1', clubId: 'CARC', socioId: null } };
    const res = mockRes();
    await updateMyProfileHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('actualiza campos normales sin tocar el email de login (emailChanged: false)', async () => {
    User.findById.mockResolvedValue(buildUser());
    Socio.findOne.mockResolvedValue({ _id: 'socio1', correoElectronico: 'contacto@test.com' });
    Socio.findOneAndUpdate.mockResolvedValue({ _id: 'socio1', telefono: '123' });

    const req = { body: { telefono: '123' }, user: { id: 'u1', clubId: 'CARC', socioId: 'socio1' } };
    const res = mockRes();
    await updateMyProfileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ emailChanged: false }));
  });

  it('sincroniza User.email cuando cambia correoElectronico (emailChanged: true)', async () => {
    const user = buildUser();
    User.findById.mockResolvedValue(user);
    User.findOne.mockResolvedValue(null); // no hay otro user con ese email en el club
    Socio.findOne.mockResolvedValue({ _id: 'socio1', correoElectronico: 'viejo-contacto@test.com' });
    Socio.findOneAndUpdate.mockResolvedValue({ _id: 'socio1', correoElectronico: 'nuevo@test.com' });

    const req = { body: { correoElectronico: 'nuevo@test.com' }, user: { id: 'u1', clubId: 'CARC', socioId: 'socio1' } };
    const res = mockRes();
    await updateMyProfileHandler(req, res);

    expect(user.email).toBe('nuevo@test.com');
    expect(user.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ emailChanged: true }));
  });

  it('devuelve 409 si el nuevo email ya está en uso por otro usuario del club', async () => {
    User.findById.mockResolvedValue(buildUser());
    User.findOne.mockResolvedValue({ _id: 'otro' });
    Socio.findOne.mockResolvedValue({ _id: 'socio1', correoElectronico: 'viejo-contacto@test.com' });

    const req = { body: { correoElectronico: 'nuevo@test.com' }, user: { id: 'u1', clubId: 'CARC', socioId: 'socio1' } };
    const res = mockRes();
    await updateMyProfileHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(Socio.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('no marca emailChanged si correoElectronico se manda igual al actual', async () => {
    const user = buildUser();
    User.findById.mockResolvedValue(user);
    Socio.findOne.mockResolvedValue({ _id: 'socio1', correoElectronico: 'mismo@test.com' });
    Socio.findOneAndUpdate.mockResolvedValue({ _id: 'socio1', correoElectronico: 'mismo@test.com' });

    const req = { body: { correoElectronico: 'mismo@test.com' }, user: { id: 'u1', clubId: 'CARC', socioId: 'socio1' } };
    const res = mockRes();
    await updateMyProfileHandler(req, res);

    expect(user.save).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ emailChanged: false }));
  });

  it('al editar un hijo vinculado (socioId activo distinto del propio) actualiza el Socio del hijo sin tocar las credenciales del padre', async () => {
    const user = buildUser({ socioId: 'socio-papa', email: 'papa@test.com' });
    User.findById.mockResolvedValue(user);
    Socio.findOne.mockResolvedValue({ _id: 'socio-hijo', correoElectronico: 'hijo-viejo@test.com' });
    Socio.findOneAndUpdate.mockResolvedValue({ _id: 'socio-hijo', correoElectronico: 'hijo-nuevo@test.com' });

    const req = {
      body: { correoElectronico: 'hijo-nuevo@test.com', nombre: 'Hijo' },
      user: { id: 'u1', clubId: 'CARC', socioId: 'socio-hijo' },
    };
    const res = mockRes();
    await updateMyProfileHandler(req, res);

    expect(Socio.findOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'socio-hijo' }));
    expect(Socio.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'socio-hijo' }),
      expect.anything(),
      expect.anything(),
    );
    expect(user.save).not.toHaveBeenCalled();
    expect(user.email).toBe('papa@test.com');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ emailChanged: false }));
  });
});
