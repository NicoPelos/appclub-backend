import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/JuegoPuntaje.js', () => ({
  default: { findOne: vi.fn(), create: vi.fn() },
}));
vi.mock('../../models/JuegoPuntajeSemanal.js', () => ({
  default: { findOne: vi.fn(), create: vi.fn() },
}));
vi.mock('../../../socios/models/Socio.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../usuarios/models/User.js', () => ({
  default: { findById: vi.fn() },
}));

import { registrarPuntajeHandler } from '../../handlers/registrarPuntaje.handler.js';
import JuegoPuntaje from '../../models/JuegoPuntaje.js';
import JuegoPuntajeSemanal from '../../models/JuegoPuntajeSemanal.js';
import Socio from '../../../socios/models/Socio.js';
import User from '../../../usuarios/models/User.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const chainableSelectLean = (result) => ({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });

describe('registrarPuntajeHandler', () => {
  const USER = { id: 'user1', email: 'ana@test.com', clubId: 'CARC', socioId: 'socio1' };

  beforeEach(() => {
    vi.clearAllMocks();
    Socio.findOne.mockReturnValue(chainableSelectLean({ nombre: 'Ana', apellido: 'Pérez' }));
    JuegoPuntaje.findOne.mockResolvedValue(null);
    JuegoPuntaje.create.mockResolvedValue({});
    JuegoPuntajeSemanal.findOne.mockResolvedValue(null);
    JuegoPuntajeSemanal.create.mockResolvedValue({});
  });

  it('400 si score no es un entero válido', async () => {
    const res = mockRes();
    await registrarPuntajeHandler({ user: USER, body: { score: -1 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400 si score no viene', async () => {
    const res = mockRes();
    await registrarPuntajeHandler({ user: USER, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea el primer puntaje total Y semanal del usuario, con nombre del socio', async () => {
    const res = mockRes();
    await registrarPuntajeHandler({ user: USER, body: { score: 7 } }, res);

    expect(JuegoPuntaje.create).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', userId: 'user1', socioId: 'socio1', nombre: 'Ana', apellido: 'Pérez', score: 7,
    }));
    expect(JuegoPuntajeSemanal.create).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', userId: 'user1', score: 7, semana: expect.any(String),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ mejoro: true, mejorPuntaje: 7, mejoroSemanal: true, mejorPuntajeSemanal: 7 });
  });

  it('sin socioId, usa el nombre del User', async () => {
    User.findById.mockReturnValue(chainableSelectLean({ nombre: 'Staff Sin Socio' }));

    const res = mockRes();
    await registrarPuntajeHandler({ user: { ...USER, socioId: null }, body: { score: 3 } }, res);

    expect(JuegoPuntaje.create).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Staff Sin Socio', socioId: null }));
  });

  it('actualiza el total si el nuevo puntaje es mayor, aunque no mejore la semana (ya tenía más esta semana)', async () => {
    const saveTotal = vi.fn().mockResolvedValue(undefined);
    JuegoPuntaje.findOne.mockResolvedValue({ score: 5, save: saveTotal });
    const saveSemanal = vi.fn().mockResolvedValue(undefined);
    JuegoPuntajeSemanal.findOne.mockResolvedValue({ score: 20, save: saveSemanal });

    const res = mockRes();
    await registrarPuntajeHandler({ user: USER, body: { score: 10 } }, res);

    expect(saveTotal).toHaveBeenCalled();
    expect(saveSemanal).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ mejoro: true, mejorPuntaje: 10, mejoroSemanal: false, mejorPuntajeSemanal: 20 });
  });

  it('no toca nada si el nuevo puntaje es menor o igual al guardado en ambos', async () => {
    const saveTotal = vi.fn();
    JuegoPuntaje.findOne.mockResolvedValue({ score: 10, save: saveTotal });
    const saveSemanal = vi.fn();
    JuegoPuntajeSemanal.findOne.mockResolvedValue({ score: 10, save: saveSemanal });

    const res = mockRes();
    await registrarPuntajeHandler({ user: USER, body: { score: 4 } }, res);

    expect(saveTotal).not.toHaveBeenCalled();
    expect(saveSemanal).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ mejoro: false, mejorPuntaje: 10, mejoroSemanal: false, mejorPuntajeSemanal: 10 });
  });

  it('500 si algo falla', async () => {
    Socio.findOne.mockImplementation(() => { throw new Error('boom'); });
    const res = mockRes();
    await registrarPuntajeHandler({ user: USER, body: { score: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
