import { describe, it, expect, vi, afterEach } from 'vitest';
import { getClubMercadoPagoConfigHandler } from '../../handlers/getClubMercadoPagoConfig.handler.js';
import { updateClubMercadoPagoConfigHandler } from '../../handlers/updateClubMercadoPagoConfig.handler.js';
import Club from '../../../clubs/models/Club.js';
import MercadoPagoConfig from '../../../pagos/models/MercadoPagoConfig.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const CLUB = { _id: 'c1', slug: 'carc', nombre: 'CARC' };

describe('Super — clubMercadoPagoConfig handlers (unit)', () => {
  afterEach(() => vi.clearAllMocks());

  describe('getClubMercadoPagoConfigHandler', () => {
    it('devuelve 404 si el club no existe', async () => {
      Club.findById = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const req = { params: { id: 'x' } };
      const res = mockRes();
      await getClubMercadoPagoConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('devuelve null si el club no tiene Mercado Pago configurado', async () => {
      Club.findById = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      MercadoPagoConfig.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const req = { params: { id: 'c1' } };
      const res = mockRes();
      await getClubMercadoPagoConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(null);
    });

    it('nunca devuelve accessToken ni webhookSecret', async () => {
      Club.findById = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      MercadoPagoConfig.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ clubId: 'carc', publicKey: 'pub-1' }) });
      const req = { params: { id: 'c1' } };
      const res = mockRes();
      await getClubMercadoPagoConfigHandler(req, res);
      expect(MercadoPagoConfig.findOne).toHaveBeenCalledWith({ clubId: 'carc' }, '-accessToken -webhookSecret');
      expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({ accessToken: expect.anything(), webhookSecret: expect.anything() }));
    });
  });

  describe('updateClubMercadoPagoConfigHandler', () => {
    it('devuelve 404 si el club no existe', async () => {
      Club.findById = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const req = { params: { id: 'x' }, body: {} };
      const res = mockRes();
      await updateClubMercadoPagoConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('devuelve 400 si es la primera configuración y falta accessToken', async () => {
      Club.findById = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      MercadoPagoConfig.findOne = vi.fn().mockResolvedValue(null);
      const req = { params: { id: 'c1' }, body: { publicKey: 'pub' }, user: { email: 'super@test.com' } };
      const res = mockRes();
      await updateClubMercadoPagoConfigHandler(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('crea la configuración por primera vez', async () => {
      Club.findById = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      MercadoPagoConfig.findOne = vi.fn().mockResolvedValue(null);
      const selectMock = vi.fn().mockResolvedValue({ clubId: 'carc' });
      MercadoPagoConfig.findOneAndUpdate = vi.fn().mockReturnValue({ select: selectMock });

      const req = { params: { id: 'c1' }, body: { accessToken: 'TEST-token', webhookSecret: 'sec' }, user: { email: 'super@test.com' } };
      const res = mockRes();
      await updateClubMercadoPagoConfigHandler(req, res);

      expect(MercadoPagoConfig.findOneAndUpdate).toHaveBeenCalledWith(
        { clubId: 'carc' },
        { $set: expect.objectContaining({ clubId: 'carc', accessToken: 'TEST-token', webhookSecret: 'sec' }) },
        { upsert: true, new: true, runValidators: true },
      );
      expect(selectMock).toHaveBeenCalledWith('-accessToken -webhookSecret');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('permite actualizar publicKey/active sin reenviar accessToken', async () => {
      Club.findById = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(CLUB) });
      MercadoPagoConfig.findOne = vi.fn().mockResolvedValue({ clubId: 'carc', accessToken: 'ya-guardado' });
      const selectMock = vi.fn().mockResolvedValue({ clubId: 'carc', publicKey: 'nueva' });
      MercadoPagoConfig.findOneAndUpdate = vi.fn().mockReturnValue({ select: selectMock });

      const req = { params: { id: 'c1' }, body: { publicKey: 'nueva', active: false }, user: { email: 'super@test.com' } };
      const res = mockRes();
      await updateClubMercadoPagoConfigHandler(req, res);

      const setArg = MercadoPagoConfig.findOneAndUpdate.mock.calls[0][1].$set;
      expect(setArg).not.toHaveProperty('accessToken');
      expect(setArg).not.toHaveProperty('webhookSecret');
      expect(setArg.publicKey).toBe('nueva');
      expect(setArg.active).toBe(false);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
