import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSuscripcionesHandler } from '../../handlers/getSuscripciones.handler.js';

vi.mock('../../models/Suscripcion.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../planes/models/Plan.js', () => ({
  default: { find: vi.fn() },
}));

import Suscripcion from '../../models/Suscripcion.js';
import Plan from '../../../planes/models/Plan.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const makeChain = (result) => {
  const chain = {};
  chain.populate = vi.fn().mockReturnValue(chain);
  chain.sort = vi.fn().mockReturnValue(chain);
  chain.lean = vi.fn().mockResolvedValue(result);
  return chain;
};

beforeEach(() => {
  vi.clearAllMocks();
  Plan.find.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
});

describe('getSuscripcionesHandler', () => {
  it('retorna lista de suscripciones filtradas por socioId', async () => {
    const suscripciones = [
      { socioId: 'socio1', etiquetaId: { nombre: 'Cuota Social', unidad: 'mes' }, fechaDesde: '2026-01' },
    ];
    Suscripcion.find.mockReturnValue(makeChain(suscripciones));

    const req = { user: mockUser, query: { socioId: '507f1f77bcf86cd799439011' } };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    expect(Suscripcion.find).toHaveBeenCalledWith(expect.objectContaining({ socioId: '507f1f77bcf86cd799439011', clubId: 'CARC' }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(suscripciones);
  });

  it('retorna todas las suscripciones del club si no se pasa socioId', async () => {
    Suscripcion.find.mockReturnValue(makeChain([]));

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    const filterUsed = Suscripcion.find.mock.calls[0][0];
    expect(filterUsed).not.toHaveProperty('socioId');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('filtra solo activas cuando activa=true (fechaHasta null)', async () => {
    Suscripcion.find.mockReturnValue(makeChain([]));

    const req = { user: mockUser, query: { socioId: '507f1f77bcf86cd799439011', activa: 'true' } };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    expect(Suscripcion.find).toHaveBeenCalledWith(expect.objectContaining({ fechaHasta: null }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('no agrega filtro fechaHasta cuando activa no es true', async () => {
    Suscripcion.find.mockReturnValue(makeChain([]));

    const req = { user: mockUser, query: { socioId: '507f1f77bcf86cd799439011' } };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    const filterUsed = Suscripcion.find.mock.calls[0][0];
    expect(filterUsed).not.toHaveProperty('fechaHasta');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('filtra por planTipo buscando planIds del tipo indicado', async () => {
    const planId = '507f1f77bcf86cd799439099';
    Plan.find.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([{ _id: planId }]),
      }),
    });
    Suscripcion.find.mockReturnValue(makeChain([]));

    const req = { user: mockUser, query: { planTipo: 'muro_libre' } };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    expect(Plan.find).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'muro_libre' }));
    expect(Suscripcion.find).toHaveBeenCalledWith(expect.objectContaining({
      planId: { $in: [planId] },
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 400 si planTipo es inválido', async () => {
    const req = { user: mockUser, query: { planTipo: 'invalido' } };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(Suscripcion.find).not.toHaveBeenCalled();
  });

  it('retorna 400 si socioId no es un ObjectId válido', async () => {
    const req = { user: mockUser, query: { socioId: 'no-es-un-id' } };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(Suscripcion.find).not.toHaveBeenCalled();
  });

  it('popula planId y etiquetaId', async () => {
    const chain = makeChain([]);
    Suscripcion.find.mockReturnValue(chain);

    const req = { user: mockUser, query: { socioId: '507f1f77bcf86cd799439011' } };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    expect(chain.populate).toHaveBeenCalledWith('planId', 'nombre tipo modalidad atributos');
    expect(chain.populate).toHaveBeenCalledWith('etiquetaId', 'nombre unidad');
  });

  it('retorna 500 si hay error de base de datos', async () => {
    const errChain = {};
    errChain.populate = vi.fn().mockReturnValue(errChain);
    errChain.sort = vi.fn().mockReturnValue(errChain);
    errChain.lean = vi.fn().mockRejectedValue(new Error('DB error'));
    Suscripcion.find.mockReturnValue(errChain);

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getSuscripcionesHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
