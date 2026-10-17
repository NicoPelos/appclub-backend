import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateHorarioHandler } from '../../handlers/updateHorario.handler.js';
import Horarios from '../../models/Horarios.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1', roles: ['admin'] };

const makeHorario = (overrides = {}) => ({
  _id: 'h1',
  fecha: new Date('2026-06-01'),
  horaEntrada: new Date('2026-06-01T19:30:00'),
  horaSalida: new Date('2026-06-01T22:00:00'),
  totalHoras: 2.5,
  observaciones: '',
  active: true,
  updatedBy: '',
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('updateHorarioHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 404 when horario is not found', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(null);
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: { totalHoras: 3 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Horario no encontrado' });
  });

  it('should return 400 when fecha is invalid', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(makeHorario());
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: { fecha: 'no-fecha' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La fecha es inválida' });
  });

  it('should return 400 when horaEntrada is invalid', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(makeHorario());
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: { horaEntrada: 'no-fecha' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La hora de entrada es inválida' });
  });

  it('should return 400 when horaSalida is invalid', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(makeHorario());
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: { horaSalida: 'no-fecha' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La hora de salida es inválida' });
  });

  it('should return 400 when totalHoras is negative', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(makeHorario());
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: { totalHoras: -3 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El totalHoras debe ser un número mayor o igual a 0' });
  });

  it('should return 400 when totalHoras exceeds the upper bound', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(makeHorario());
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: { totalHoras: 999999 }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El totalHoras no puede superar 24 horas' });
  });

  it('should update fields and return 200', async () => {
    const horario = makeHorario();
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(horario);
    const etqId = '507f1f77bcf86cd799439011';
    vi.spyOn(Etiqueta, 'findOne').mockResolvedValue({ _id: etqId });
    const res = mockRes();
    await updateHorarioHandler(
      { params: { id: 'h1' }, body: { etiquetaId: etqId, totalHoras: 3 }, user: USER },
      res,
    );
    expect(horario.etiquetaId).toBe(etqId);
    expect(horario.totalHoras).toBe(3);
    expect(horario.updatedBy).toBe('admin@carc.test');
    expect(horario.save).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 404 when etiquetaId does not belong to the caller club', async () => {
    const horario = makeHorario();
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(horario);
    vi.spyOn(Etiqueta, 'findOne').mockResolvedValue(null);
    const res = mockRes();
    const etqId = '507f1f77bcf86cd799439099';
    await updateHorarioHandler(
      { params: { id: 'h1' }, body: { etiquetaId: etqId }, user: USER },
      res,
    );
    expect(Etiqueta.findOne).toHaveBeenCalledWith(expect.objectContaining({ _id: etqId, clubId: USER.clubId, active: true }));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(horario.save).not.toHaveBeenCalled();
  });

  it('should scope the lookup to the caller club (no cross-club write)', async () => {
    vi.spyOn(Horarios, 'findOne').mockResolvedValue(makeHorario());
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: { totalHoras: 3 }, user: USER }, res);
    expect(Horarios.findOne).toHaveBeenCalledWith(expect.objectContaining({ clubId: USER.clubId }));
  });

  it('should return 500 on unexpected error', async () => {
    vi.spyOn(Horarios, 'findOne').mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await updateHorarioHandler({ params: { id: 'h1' }, body: {}, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
