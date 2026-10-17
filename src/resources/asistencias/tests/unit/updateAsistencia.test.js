import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateAsistenciaHandler } from '../../handlers/updateAsistencia.handler.js';
import Asistencia from '../../models/Asistencia.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'secretaria@carc.test', clubId: 'club1' };

afterEach(() => vi.restoreAllMocks());

describe('updateAsistenciaHandler', () => {
  it('devuelve 404 si la asistencia no existe', async () => {
    vi.spyOn(Asistencia, 'findOneAndUpdate').mockResolvedValue(null);
    const res = mockRes();

    await updateAsistenciaHandler({ params: { id: 'a1' }, body: {}, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('actualiza observaciones, categoria y fecha cuando son válidas', async () => {
    const actualizada = { _id: 'a1' };
    const updateSpy = vi.spyOn(Asistencia, 'findOneAndUpdate').mockResolvedValue(actualizada);
    const res = mockRes();

    await updateAsistenciaHandler({
      params: { id: 'a1' },
      body: { observaciones: 'ok', categoria: 'niños', fecha: '2026-01-05T12:00:00.000Z' },
      user: USER,
    }, res);

    expect(updateSpy).toHaveBeenCalledWith(
      { _id: 'a1', clubId: USER.clubId, tipo: 'escuelita', active: true },
      expect.objectContaining({
        observaciones: 'ok',
        categoria: 'niños',
        fecha: new Date('2026-01-05T12:00:00.000Z'),
      }),
      { returnDocument: 'after' },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#219: no toca asistencias de muro_libre — la query filtra por tipo:escuelita', async () => {
    const updateSpy = vi.spyOn(Asistencia, 'findOneAndUpdate').mockResolvedValue(null);
    const res = mockRes();

    await updateAsistenciaHandler({ params: { id: 'muro1' }, body: { observaciones: 'x' }, user: USER }, res);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'escuelita' }),
      expect.anything(),
      expect.anything(),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rechaza una fecha inválida', async () => {
    const updateSpy = vi.spyOn(Asistencia, 'findOneAndUpdate');
    const res = mockRes();

    await updateAsistenciaHandler({ params: { id: 'a1' }, body: { fecha: 'no-es-fecha' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('appcarc-backend#167: rechaza una fecha futura', async () => {
    const updateSpy = vi.spyOn(Asistencia, 'findOneAndUpdate');
    const res = mockRes();

    await updateAsistenciaHandler({ params: { id: 'a1' }, body: { fecha: '2099-01-01T12:00:00.000Z' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La fecha de la asistencia no puede ser futura' });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('devuelve 500 ante un error inesperado', async () => {
    vi.spyOn(Asistencia, 'findOneAndUpdate').mockRejectedValue(new Error('DB down'));
    const res = mockRes();

    await updateAsistenciaHandler({ params: { id: 'a1' }, body: {}, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
