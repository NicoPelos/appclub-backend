import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/CargoPuntual.js', () => ({
  default: { find: vi.fn() },
}));

import CargoPuntual from '../../models/CargoPuntual.js';
import { getCargosPuntualesHandler } from '../../handlers/getCargosPuntuales.handler.js';

const CLUB_ID = 'CARC';

const buildRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockFind = (cargos) => {
  const query = {
    sort: vi.fn().mockReturnThis(),
    populate: vi.fn().mockReturnThis(),
    then: (resolve) => resolve(cargos),
  };
  CargoPuntual.find.mockReturnValue(query);
  return query;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFind([]);
});

describe('getCargosPuntualesHandler', () => {
  it('con req.accessibleSocioIds (autoservicio), filtra socioId con $in y no usa query.socioId', async () => {
    const req = {
      user: { clubId: CLUB_ID },
      query: {},
      accessibleSocioIds: new Set(['socio1', 'hijo1']),
    };
    const res = buildRes();

    await getCargosPuntualesHandler(req, res);

    expect(CargoPuntual.find).toHaveBeenCalledWith(expect.objectContaining({
      socioId: { $in: expect.arrayContaining(['socio1', 'hijo1']) },
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('con query.socioId (consulta de staff), filtra por ese socio puntual — incluso si el usuario también es socio', async () => {
    const req = { user: { clubId: CLUB_ID }, query: { socioId: 'otro-socio' } };
    const res = buildRes();

    await getCargosPuntualesHandler(req, res);

    expect(CargoPuntual.find).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'otro-socio' }));
  });

  it('sin accessibleSocioIds ni query.socioId, no agrega filtro de socio (listado general de staff)', async () => {
    const req = { user: { clubId: CLUB_ID }, query: {} };
    const res = buildRes();

    await getCargosPuntualesHandler(req, res);

    const filtroUsado = CargoPuntual.find.mock.calls[0][0];
    expect(filtroUsado).not.toHaveProperty('socioId');
  });

  it('filtra además por estado si viene en el query', async () => {
    const req = { user: { clubId: CLUB_ID }, query: { estado: 'pendiente' } };
    const res = buildRes();

    await getCargosPuntualesHandler(req, res);

    expect(CargoPuntual.find).toHaveBeenCalledWith(expect.objectContaining({ estado: 'pendiente' }));
  });
});
