import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHorariosHandler } from '../../handlers/getHorarios.handler.js';
import Horarios from '../../models/Horarios.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1', roles: ['admin'] };

const makeQuery = (data) => ({
  populate: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue(data),
});

describe('getHorariosHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return active horarios by default', async () => {
    const items = [{ _id: 'h1', active: true }];
    vi.spyOn(Horarios, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Horarios, 'find').mockReturnValue(makeQuery(items));

    const res = mockRes();
    await getHorariosHandler({ query: {}, user: USER }, res);

    expect(Horarios.find).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.horarios).toEqual(items);
    expect(body.total).toBe(1);
  });

  it('should return deleted horarios when trash=true', async () => {
    vi.spyOn(Horarios, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Horarios, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getHorariosHandler({ query: { trash: 'true' }, user: USER }, res);

    expect(Horarios.find).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should filter by socioId', async () => {
    vi.spyOn(Horarios, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Horarios, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getHorariosHandler({ query: { socioId: 'socio123' }, user: USER }, res);

    expect(Horarios.find).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socio123' }));
  });

  it('should filter by etiquetaId', async () => {
    vi.spyOn(Horarios, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Horarios, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getHorariosHandler({ query: { etiquetaId: 'etq123' }, user: USER }, res);

    expect(Horarios.find).toHaveBeenCalledWith(expect.objectContaining({ etiquetaId: 'etq123' }));
  });

  it('should filter by date range when desde and hasta provided', async () => {
    vi.spyOn(Horarios, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Horarios, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getHorariosHandler({ query: { desde: '2026-06-01', hasta: '2026-06-30' }, user: USER }, res);

    const callArg = Horarios.find.mock.calls[0][0];
    expect(callArg.fecha).toHaveProperty('$gte');
    expect(callArg.fecha).toHaveProperty('$lte');
  });

  it('should return 500 on unexpected error', async () => {
    vi.spyOn(Horarios, 'countDocuments').mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await getHorariosHandler({ query: {}, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should scope to own socioId for roles without full visibility (ej. limpieza, arreglos)', async () => {
    vi.spyOn(Horarios, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Horarios, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    const user = { id: 'user2', clubId: 'club1', roles: ['limpieza'], socioId: 'socio-propio' };
    await getHorariosHandler({ query: { socioId: 'otro-socio' }, user }, res);

    // El socioId propio manda, ignorando cualquier socioId que venga por query.
    expect(Horarios.find).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socio-propio' }));
  });

  it('should return an empty list for roles without full visibility and sin socioId propio', async () => {
    const findSpy = vi.spyOn(Horarios, 'find');
    const res = mockRes();
    const user = { id: 'user3', clubId: 'club1', roles: ['limpieza'] };
    await getHorariosHandler({ query: {}, user }, res);

    expect(findSpy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.horarios).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('autoridad ve todo (rol de solo lectura, no en ROLES_EDIT_ALL)', async () => {
    vi.spyOn(Horarios, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Horarios, 'find').mockReturnValue(makeQuery([{ _id: 'h1' }]));

    const res = mockRes();
    const user = { id: 'user4', clubId: 'club1', roles: ['autoridad'] };
    await getHorariosHandler({ query: {}, user }, res);

    expect(Horarios.find).toHaveBeenCalledWith(expect.not.objectContaining({ socioId: expect.anything() }));
  });
});
