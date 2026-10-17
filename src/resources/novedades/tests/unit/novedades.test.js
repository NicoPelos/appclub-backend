import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNovedadesHandler } from '../../handlers/getNovedades.handler.js';
import { createNovedadHandler } from '../../handlers/createNovedad.handler.js';
import { syncNovedadesHandler } from '../../handlers/syncNovedades.handler.js';
import Novedad from '../../models/Novedad.js';
import * as syncService from '../../services/syncInstagram.service.js';
import * as pushService from '../../../../services/pushNotification.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const USER = { id: 'staff1', email: 'secretaria@carc.test', clubId: 'club1' };

describe('getNovedadesHandler', () => {
  beforeEach(() => {
    Novedad.countDocuments = vi.fn().mockResolvedValue(2);
    Novedad.find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([{ _id: 'n1', titulo: 'Post 1' }, { _id: 'n2', titulo: 'Post 2' }]),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('should return paginated novedades', async () => {
    const req = { query: {}, user: USER };
    const res = mockRes();

    await getNovedadesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      total: 2,
      novedades: expect.arrayContaining([expect.objectContaining({ titulo: 'Post 1' })]),
    }));
  });

  it('should apply fuente and categoria filters', async () => {
    const req = { query: { fuente: 'instagram', categoria: 'eventos' }, user: USER };
    const res = mockRes();

    await getNovedadesHandler(req, res);

    expect(Novedad.find).toHaveBeenCalledWith(expect.objectContaining({
      fuente: 'instagram',
      categoria: 'eventos',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 500 on unexpected error', async () => {
    Novedad.countDocuments.mockRejectedValue(new Error('DB down'));
    const req = { query: {}, user: USER };
    const res = mockRes();

    await getNovedadesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('createNovedadHandler', () => {
  beforeEach(() => {
    vi.spyOn(Novedad.prototype, 'save').mockResolvedValue({});
    vi.spyOn(pushService, 'notifyClub').mockResolvedValue({ sent: 0 });
  });

  afterEach(() => vi.restoreAllMocks());

  it('should create novedad and return 201', async () => {
    const req = {
      body: { titulo: 'Nueva actividad', cuerpo: 'El club abre...' },
      user: USER,
    };
    const res = mockRes();

    await createNovedadHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(pushService.notifyClub).toHaveBeenCalledWith('club1', expect.objectContaining({
      title: 'Nueva actividad',
    }));
  });

  it('should return 400 when titulo is missing', async () => {
    const req = { body: { cuerpo: 'Sin titulo' }, user: USER };
    const res = mockRes();

    await createNovedadHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El título es obligatorio' });
    expect(Novedad.prototype.save).not.toHaveBeenCalled();
  });

  it('should return 500 on unexpected error', async () => {
    vi.spyOn(Novedad.prototype, 'save').mockRejectedValue(new Error('DB down'));
    const req = { body: { titulo: 'Test' }, user: USER };
    const res = mockRes();

    await createNovedadHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('syncNovedadesHandler', () => {
  beforeEach(() => {
    vi.spyOn(syncService, 'syncInstagramFeed').mockResolvedValue({ inserted: 3, skipped: 1, total: 4 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return sync results on success', async () => {
    const req = { user: USER };
    const res = mockRes();

    await syncNovedadesHandler(req, res);

    expect(syncService.syncInstagramFeed).toHaveBeenCalledWith({ clubId: 'club1' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      inserted: 3,
      skipped: 1,
      total: 4,
    }));
  });

  it('should return 500 when sync fails', async () => {
    vi.spyOn(syncService, 'syncInstagramFeed').mockRejectedValue(new Error('Instagram no está configurado para este club'));
    const req = { user: USER };
    const res = mockRes();

    await syncNovedadesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Instagram no está configurado para este club' });
  });
});
