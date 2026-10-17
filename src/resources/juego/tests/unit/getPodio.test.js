import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/JuegoPuntaje.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn() },
}));
vi.mock('../../models/JuegoPuntajeSemanal.js', () => ({
  default: { find: vi.fn(), findOne: vi.fn() },
}));

import { getPodioHandler } from '../../handlers/getPodio.handler.js';
import JuegoPuntaje from '../../models/JuegoPuntaje.js';
import JuegoPuntajeSemanal from '../../models/JuegoPuntajeSemanal.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const chainableFind = (result) => ({
  sort: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});
const chainableFindOne = (result) => ({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });

describe('getPodioHandler', () => {
  const USER = { id: 'user1', clubId: 'CARC' };

  beforeEach(() => {
    vi.clearAllMocks();
    JuegoPuntaje.find.mockReturnValue(chainableFind([]));
    JuegoPuntaje.findOne.mockReturnValue(chainableFindOne(null));
    JuegoPuntajeSemanal.find.mockReturnValue(chainableFind([]));
    JuegoPuntajeSemanal.findOne.mockReturnValue(chainableFindOne(null));
  });

  it('devuelve el top total y el semanal, ordenados, con los mejores puntajes propios', async () => {
    const topTotal = [{ userId: 'u2', nombre: 'Meli', apellido: 'Lhez', score: 20 }];
    const topSemanal = [{ userId: 'user1', nombre: 'Ana', apellido: 'Pérez', score: 7 }];
    JuegoPuntaje.find.mockReturnValue(chainableFind(topTotal));
    JuegoPuntaje.findOne.mockReturnValue(chainableFindOne({ score: 12 }));
    JuegoPuntajeSemanal.find.mockReturnValue(chainableFind(topSemanal));
    JuegoPuntajeSemanal.findOne.mockReturnValue(chainableFindOne({ score: 7 }));

    const res = mockRes();
    await getPodioHandler({ user: USER, query: {} }, res);

    expect(JuegoPuntaje.find).toHaveBeenCalledWith({ clubId: 'CARC' });
    expect(JuegoPuntajeSemanal.find).toHaveBeenCalledWith({ clubId: 'CARC', semana: expect.any(String) });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      podioTotal: topTotal,
      podioSemanal: topSemanal,
      miMejorPuntaje: 12,
      miMejorPuntajeSemanal: 7,
      semana: expect.any(String),
    });
  });

  it('los mejores puntajes propios son 0 si el usuario nunca jugó', async () => {
    const res = mockRes();
    await getPodioHandler({ user: USER, query: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ miMejorPuntaje: 0, miMejorPuntajeSemanal: 0 }));
  });

  it('limit se acota entre 1 y 50, para ambos podios', async () => {
    const queryTotal = chainableFind([]);
    const querySemanal = chainableFind([]);
    JuegoPuntaje.find.mockReturnValue(queryTotal);
    JuegoPuntajeSemanal.find.mockReturnValue(querySemanal);

    const res = mockRes();
    await getPodioHandler({ user: USER, query: { limit: '999' } }, res);

    expect(queryTotal.limit).toHaveBeenCalledWith(50);
    expect(querySemanal.limit).toHaveBeenCalledWith(50);
  });

  it('500 si algo falla', async () => {
    JuegoPuntaje.find.mockImplementation(() => { throw new Error('boom'); });
    const res = mockRes();
    await getPodioHandler({ user: USER, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
