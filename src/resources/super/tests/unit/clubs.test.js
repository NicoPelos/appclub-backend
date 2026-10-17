import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../../../services/clubActivoCache.js', () => ({
  invalidarClubActivo: vi.fn(),
}));
import { getClubsHandler }    from '../../handlers/getClubs.handler.js';
import { createClubHandler }  from '../../handlers/createClub.handler.js';
import { suspendClubHandler } from '../../handlers/suspendClub.handler.js';
import { updateClubHandler } from '../../handlers/updateClub.handler.js';
import Club from '../../../clubs/models/Club.js';
import User from '../../../usuarios/models/User.js';
import Socio from '../../../socios/models/Socio.js';
import { invalidarClubActivo } from '../../../../services/clubActivoCache.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json   = vi.fn(() => res);
  return res;
};

describe('Super — clubs handlers (unit)', () => {
  beforeEach(() => {
    Club.find             = vi.fn();
    Club.findOne          = vi.fn();
    Club.findByIdAndUpdate = vi.fn();
    Club.findById         = vi.fn();
    Club.findOneAndUpdate = vi.fn().mockImplementation(async (_filtro, { $set }) => ({ _id: 'c1', slug: 'carc', ...$set }));
    Club.create           = vi.fn();
    User.countDocuments   = vi.fn().mockResolvedValue(3);
    Socio.countDocuments  = vi.fn().mockResolvedValue(10);
  });

  afterEach(() => vi.clearAllMocks());

  it('getClubsHandler devuelve clubs con métricas', async () => {
    const fakeClub = { _id: 'c1', slug: 'carc', nombre: 'CARC' };
    const chainMock = { sort: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([fakeClub]) };
    Club.find.mockReturnValue(chainMock);

    const req = {};
    const res = mockRes();
    await getClubsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ slug: 'carc', userCount: 3, socioCount: 10 }),
    ]));
  });

  it('createClubHandler devuelve 400 si falta nombre o slug', async () => {
    const req = { body: { nombre: 'Test' } };
    const res = mockRes();
    await createClubHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('createClubHandler devuelve 409 si ya existe el slug', async () => {
    Club.findOne.mockResolvedValue({ slug: 'carc' });
    const req = { body: { nombre: 'CARC', slug: 'carc' } };
    const res = mockRes();
    await createClubHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('createClubHandler guarda el slug verbatim, sin normalizar mayúsculas/minúsculas', async () => {
    // Ver el comentario grande en Club.js: el resto del sistema (User.clubId,
    // Socio.clubId, getClubs.handler.js contando por club.slug) asume slug
    // verbatim — forzarlo a minúscula ya rompió producción una vez (#75).
    Club.findOne.mockResolvedValue(null);
    Club.create.mockResolvedValue({ _id: 'c1', nombre: 'Club Andino Test', slug: 'CAT' });
    const req = { body: { nombre: 'Club Andino Test', slug: 'CAT' } };
    const res = mockRes();
    await createClubHandler(req, res);
    expect(Club.findOne).toHaveBeenCalledWith({ slug: 'CAT' });
    expect(Club.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'CAT' }));
  });

  it('createClubHandler crea el club', async () => {
    Club.findOne.mockResolvedValue(null);
    Club.create.mockResolvedValue({ _id: 'c1', nombre: 'CARC', slug: 'carc' });
    const req = { body: { nombre: 'CARC', slug: 'carc' } };
    const res = mockRes();
    await createClubHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('suspendClubHandler togglea active', async () => {
    const fakeClub = { _id: 'c1', slug: 'carc', active: true, suspendidoAt: null };
    Club.findById.mockResolvedValue(fakeClub);
    const req = { params: { id: 'c1' } };
    const res = mockRes();
    await suspendClubHandler(req, res);
    expect(Club.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'c1', active: true }, { $set: { active: false, suspendidoAt: expect.any(Date) } }, { new: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ active: false, suspendidoAt: expect.any(Date) });
  });

  it('suspendClubHandler con activo explícito es idempotente: repetir no reactiva (appcarc-backend#242)', async () => {
    const fakeClub = { _id: 'c1', slug: 'carc', active: false, suspendidoAt: new Date() };
    Club.findById.mockResolvedValue(fakeClub);
    const req = { params: { id: 'c1' }, body: { activo: false } };
    const res = mockRes();
    await suspendClubHandler(req, res);
    expect(Club.findOneAndUpdate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ active: false, suspendidoAt: fakeClub.suspendidoAt });
  });

  it('suspendClubHandler no da vuelta el estado si otro request ya lo cambió (appcarc-backend#242)', async () => {
    const fakeClub = { _id: 'c1', slug: 'carc', active: true, suspendidoAt: null };
    Club.findById.mockResolvedValueOnce(fakeClub).mockResolvedValueOnce({ _id: 'c1', active: false, suspendidoAt: new Date() });
    Club.findOneAndUpdate.mockResolvedValueOnce(null);
    const req = { params: { id: 'c1' } };
    const res = mockRes();
    await suspendClubHandler(req, res);
    expect(res.json).toHaveBeenCalledWith({ active: false, suspendidoAt: expect.any(Date) });
  });

  it('suspendClubHandler invalida el cache de esClubActivo (appcarc-backend#169)', async () => {
    const fakeClub = { _id: 'c1', slug: 'carc', active: true, suspendidoAt: null };
    Club.findById.mockResolvedValue(fakeClub);
    const req = { params: { id: 'c1' } };
    const res = mockRes();
    await suspendClubHandler(req, res);
    expect(invalidarClubActivo).toHaveBeenCalledWith('carc');
  });

  it('updateClubHandler no pisa módulos ni integraciones que no vienen en el body (appcarc-backend#238)', async () => {
    Club.findByIdAndUpdate.mockResolvedValue({ _id: 'c1' });
    const req = { params: { id: 'c1' }, body: { modulos: { eventos: true } } };
    const res = mockRes();
    await updateClubHandler(req, res);
    expect(Club.findByIdAndUpdate).toHaveBeenCalledWith('c1', { $set: { 'modulos.eventos': true } }, { new: true, runValidators: true });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updateClubHandler rechaza modulos que no es un objeto (appcarc-backend#240)', async () => {
    const req = { params: { id: 'c1' }, body: { modulos: 'todo' } };
    const res = mockRes();
    await updateClubHandler(req, res);
    expect(Club.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
