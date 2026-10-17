import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getClubInstagramConfigHandler } from '../../handlers/getClubInstagramConfig.handler.js';
import { updateClubInstagramConfigHandler } from '../../handlers/updateClubInstagramConfig.handler.js';
import Club from '../../../clubs/models/Club.js';
import InstagramConfig from '../../../novedades/models/InstagramConfig.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const CLUB = { _id: 'c1', slug: 'carc', nombre: 'CARC' };

describe('Super — clubInstagramConfig handlers (unit)', () => {
  beforeEach(() => {
    Club.findById = vi.fn();
    InstagramConfig.findOne = vi.fn();
    InstagramConfig.findOneAndUpdate = vi.fn();
  });

  afterEach(() => vi.clearAllMocks());

  describe('getClubInstagramConfigHandler', () => {
    it('devuelve 404 si el club no existe', async () => {
      Club.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const req = { params: { id: 'x' } };
      const res = mockRes();
      await getClubInstagramConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('devuelve null si el club no tiene Instagram configurado', async () => {
      Club.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      InstagramConfig.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const req = { params: { id: 'c1' } };
      const res = mockRes();
      await getClubInstagramConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(null);
    });

    it('nunca devuelve el accessToken', async () => {
      Club.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      InstagramConfig.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ clubId: 'carc', igUserId: '123', username: 'club' }) });
      const req = { params: { id: 'c1' } };
      const res = mockRes();
      await getClubInstagramConfigHandler(req, res);
      expect(InstagramConfig.findOne).toHaveBeenCalledWith({ clubId: 'carc' }, '-accessToken');
      expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({ accessToken: expect.anything() }));
    });
  });

  describe('updateClubInstagramConfigHandler', () => {
    it('devuelve 404 si el club no existe', async () => {
      Club.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const req = { params: { id: 'x' }, body: {} };
      const res = mockRes();
      await updateClubInstagramConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('devuelve 400 si es la primera configuración y falta igUserId o accessToken', async () => {
      Club.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      InstagramConfig.findOne.mockResolvedValue(null);
      const req = { params: { id: 'c1' }, body: { username: 'club' }, user: { email: 'super@test.com' } };
      const res = mockRes();
      await updateClubInstagramConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('crea la configuración por primera vez', async () => {
      Club.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      InstagramConfig.findOne.mockResolvedValue(null);
      const selectMock = vi.fn().mockResolvedValue({ clubId: 'carc', igUserId: '123', username: 'club' });
      InstagramConfig.findOneAndUpdate.mockReturnValue({ select: selectMock });

      const req = { params: { id: 'c1' }, body: { igUserId: '123', username: 'club', accessToken: 'secret-token' }, user: { email: 'super@test.com' } };
      const res = mockRes();
      await updateClubInstagramConfigHandler(req, res);

      expect(InstagramConfig.findOneAndUpdate).toHaveBeenCalledWith(
        { clubId: 'carc' },
        { $set: expect.objectContaining({ clubId: 'carc', igUserId: '123', username: 'club', accessToken: 'secret-token' }) },
        { upsert: true, new: true, runValidators: true },
      );
      expect(selectMock).toHaveBeenCalledWith('-accessToken');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('permite actualizar username sin reenviar el accessToken', async () => {
      Club.findById.mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      InstagramConfig.findOne.mockResolvedValue({ clubId: 'carc', igUserId: '123', accessToken: 'ya-guardado' });
      const selectMock = vi.fn().mockResolvedValue({ clubId: 'carc', igUserId: '123', username: 'nuevo' });
      InstagramConfig.findOneAndUpdate.mockReturnValue({ select: selectMock });

      const req = { params: { id: 'c1' }, body: { username: 'nuevo' }, user: { email: 'super@test.com' } };
      const res = mockRes();
      await updateClubInstagramConfigHandler(req, res);

      const setArg = InstagramConfig.findOneAndUpdate.mock.calls[0][1].$set;
      expect(setArg).not.toHaveProperty('accessToken');
      expect(setArg.username).toBe('nuevo');
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
