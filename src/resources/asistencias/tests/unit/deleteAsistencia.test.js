import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteAsistenciaHandler } from '../../handlers/deleteAsistencia.handler.js';
import Asistencia from '../../models/Asistencia.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'secretaria@carc.test', clubId: 'club1' };

afterEach(() => vi.restoreAllMocks());

describe('deleteAsistenciaHandler', () => {
  it('devuelve 404 si la asistencia no existe', async () => {
    vi.spyOn(Asistencia, 'findOneAndUpdate').mockResolvedValue(null);
    const res = mockRes();

    await deleteAsistenciaHandler({ params: { id: 'a1' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('anula la asistencia de escuelita (active:false)', async () => {
    const updateSpy = vi.spyOn(Asistencia, 'findOneAndUpdate').mockResolvedValue({ _id: 'a1', active: false });
    const res = mockRes();

    await deleteAsistenciaHandler({ params: { id: 'a1' }, user: USER }, res);

    expect(updateSpy).toHaveBeenCalledWith(
      { _id: 'a1', clubId: USER.clubId, tipo: 'escuelita', active: true },
      expect.objectContaining({ active: false }),
      { returnDocument: 'after' },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#219: no anula asistencias de muro_libre (dejaría cobro/cuota huérfanos) — la query filtra por tipo:escuelita', async () => {
    const updateSpy = vi.spyOn(Asistencia, 'findOneAndUpdate').mockResolvedValue(null);
    const res = mockRes();

    await deleteAsistenciaHandler({ params: { id: 'muro1' }, user: USER }, res);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'escuelita' }),
      expect.anything(),
      expect.anything(),
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('devuelve 500 ante un error inesperado', async () => {
    vi.spyOn(Asistencia, 'findOneAndUpdate').mockRejectedValue(new Error('DB down'));
    const res = mockRes();

    await deleteAsistenciaHandler({ params: { id: 'a1' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
