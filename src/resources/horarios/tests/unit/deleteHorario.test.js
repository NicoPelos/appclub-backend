import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteHorarioHandler } from '../../handlers/deleteHorario.handler.js';
import Horarios from '../../models/Horarios.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };

const makeHorario = (overrides = {}) => ({
  _id: 'h1',
  active: true,
  deletedAt: null,
  deletedBy: null,
  updatedBy: '',
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('deleteHorarioHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 404 when horario is not found', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(null);
    const res = mockRes();
    await deleteHorarioHandler({ params: { id: 'h1' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Horario no encontrado' });
  });

  it('should soft delete and return 200', async () => {
    const horario = makeHorario();
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(horario);
    const res = mockRes();
    await deleteHorarioHandler({ params: { id: 'h1' }, user: USER }, res);

    expect(horario.active).toBe(false);
    expect(horario.deletedAt).toBeInstanceOf(Date);
    expect(horario.deletedBy).toBe('admin@carc.test');
    expect(horario.updatedBy).toBe('admin@carc.test');
    expect(horario.save).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Horario eliminado' });
  });

  it('should scope the lookup to the caller club (no cross-club delete)', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(makeHorario());
    const res = mockRes();
    await deleteHorarioHandler({ params: { id: 'h1' }, user: USER }, res);
    expect(Horarios.findOne).toHaveBeenCalledWith(expect.objectContaining({ clubId: USER.clubId }));
  });

  it('should return 500 on unexpected error', async () => {
    vi.spyOn(Horarios, 'findOne').mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await deleteHorarioHandler({ params: { id: 'h1' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
