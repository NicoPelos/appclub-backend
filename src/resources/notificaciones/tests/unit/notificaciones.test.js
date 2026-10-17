import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Notification.js', () => ({
  default: {
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

import { getMisNotificacionesHandler } from '../../handlers/getMisNotificaciones.handler.js';
import { markNotificacionLeidaHandler } from '../../handlers/markNotificacionLeida.handler.js';
import { deleteNotificacionesLeidasHandler } from '../../handlers/deleteNotificacionesLeidas.handler.js';
import Notification from '../../models/Notification.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('getMisNotificacionesHandler', () => {
  it('devuelve las notificaciones del usuario ordenadas por más reciente', async () => {
    const chain = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue([{ title: 'Hola' }]) };
    Notification.find.mockReturnValue(chain);

    const req = { user: { id: 'user1', clubId: 'CARC' } };
    const res = mockRes();
    await getMisNotificacionesHandler(req, res);

    expect(Notification.find).toHaveBeenCalledWith({ userId: 'user1', clubId: 'CARC' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ notifications: [{ title: 'Hola' }] });
  });

  it('retorna 500 si hay error', async () => {
    Notification.find.mockImplementation(() => { throw new Error('DB'); });

    const req = { user: { id: 'user1', clubId: 'CARC' } };
    const res = mockRes();
    await getMisNotificacionesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('markNotificacionLeidaHandler', () => {
  it('marca la notificación como leída', async () => {
    Notification.findOneAndUpdate.mockResolvedValue({ _id: 'n1', read: true });

    const req = { params: { id: 'n1' }, user: { id: 'user1', clubId: 'CARC' } };
    const res = mockRes();
    await markNotificacionLeidaHandler(req, res);

    expect(Notification.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'n1', userId: 'user1', clubId: 'CARC' },
      { read: true },
      { new: true },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 404 si no existe o no es del usuario', async () => {
    Notification.findOneAndUpdate.mockResolvedValue(null);

    const req = { params: { id: 'n1' }, user: { id: 'user1', clubId: 'CARC' } };
    const res = mockRes();
    await markNotificacionLeidaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('deleteNotificacionesLeidasHandler', () => {
  it('elimina las notificaciones leídas del usuario', async () => {
    Notification.deleteMany.mockResolvedValue({ deletedCount: 3 });

    const req = { user: { id: 'user1', clubId: 'CARC' } };
    const res = mockRes();
    await deleteNotificacionesLeidasHandler(req, res);

    expect(Notification.deleteMany).toHaveBeenCalledWith({ userId: 'user1', clubId: 'CARC', read: true });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
